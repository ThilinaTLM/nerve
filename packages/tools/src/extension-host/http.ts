import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  ExtensionError,
  type AccountAuth,
  type AccountInfo,
  type ArtifactRef,
  type HttpRequest,
  type HttpResponse,
} from "@nervekit/extension-api";
import { narrowOrigins } from "@nervekit/contracts/extensions";
import { withTimeoutSignal } from "../execution/process/abort.js";
import {
  assertSafeHttpUrl,
  createPinnedFetch,
} from "../execution/network/network-policy.js";
import { fillTemplate, expandPatterns, originMatches } from "./network.js";
import { baseContentType, getExtension } from "../execution/web/web-fetch.js";
import { settingsPage } from "./errors.js";
import type { CredentialBody, ExtensionHostPorts } from "./ports.js";

const MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 300_000;
/** Largest response kept in memory (`json`, `text`, `bytes`). */
export const MAX_MEMORY_RESPONSE_BYTES = 20 * 1024 * 1024;
/** Largest response streamed to an artifact. */
export const MAX_ARTIFACT_RESPONSE_BYTES = 100 * 1024 * 1024;

/** What `ctx.http` needs from the run; everything else comes from the manifest. */
export type HttpHostDeps = {
  extensionName: string;
  /** `permissions.network` of the manifest. */
  network: readonly string[];
  /** Account kinds of the extension, by kind, with the parts the host needs to inject credentials. */
  kinds: Readonly<
    Record<
      string,
      {
        label: string;
        auth?: AccountKindAuth;
        origins?: readonly string[];
        /** A platform definition of another extension: the origins this extension declared; the credential goes only to those the definition also lists. */
        useOrigins?: readonly string[];
      }
    >
  >;
  /** Kinds an `account` setting accepts; empty when `field` is not one. */
  kindsOfField(field: string): readonly string[];
  /** The account the setting selects, when it exists. */
  selected(field: string): Promise<AccountInfo | undefined>;
  /** Every selected account of the extension, for `{account.<field>}` templates. */
  allSelected(): Promise<AccountInfo[]>;
  /** Resolved settings of the extension, for `{settings.<key>}` templates. */
  settings: Record<string, unknown>;
  /** The credential vault: what an account's credential adds to a hop. Host-only. */
  credential: Pick<
    ExtensionHostPorts["accounts"],
    "state" | "apply" | "refreshAfterRejection"
  >;
  signal: AbortSignal;
  /** Plain fetch for destinations the user configured themselves in tests/host policy; others are SSRF-guarded. */
  allowPrivateNetwork?: boolean;
  /**
   * A file handle the call may read, for streaming into a request: its path
   * and size (checked against the transfer limit). The bytes never enter
   * extension code.
   */
  openHandle(handle: string): Promise<{ path: string; size: number }>;
  artifactSink(): {
    prepare(): Promise<string>;
    /** `<base>-<n><extension>`: the first name not yet taken in this run. */
    freshName(base: string, extension: string): Promise<string>;
    commit(path: string, name: string): Promise<ArtifactRef>;
  };
};

const TEXTUAL_CONTENT_TYPE = /json|text|xml|javascript|x-www-form-urlencoded/i;

/** The extension a host-named artifact gets from the response's content type. */
function extensionFor(contentType: string): string {
  return baseContentType(contentType) === "application/zip"
    ? ".zip"
    : getExtension(contentType);
}

const REDIRECT_STATUS = [301, 302, 303, 307, 308];

/** The header names an account's injections set, so the caller's own never carry a credential. */
function injectedHeaders(auth: AccountKindAuth): string[] {
  return (Array.isArray(auth) ? auth : [auth]).flatMap((injection) =>
    injection.scheme === "query"
      ? []
      : [
          injection.scheme === "header"
            ? injection.name.toLowerCase()
            : "authorization",
        ],
  );
}

type AccountKindAuth = AccountAuth | readonly AccountAuth[];

/** A failure of a hop whose URL carried a credential must not repeat it. */
function withoutSecrets(error: unknown, secrets: readonly string[]): unknown {
  if (!(error instanceof Error) || error instanceof ExtensionError)
    return error;
  let message = error.message;
  for (const secret of secrets)
    message = message
      .split(secret)
      .join("***")
      .split(encodeURIComponent(secret))
      .join("***");
  const safe = new Error(message);
  safe.name = error.name;
  return safe;
}

/** Largest body whose bytes a credential provider may read; digests have no limit. */
export const MAX_CREDENTIAL_BODY_BYTES = 20 * 1024 * 1024;

const HASHES = new Set(["sha256", "sha384", "sha512", "sha1", "md5"]);

/**
 * The body of a hop as a credential provider sees it: digests computed once per algorithm by the
 * host (streamed bodies are read once per algorithm and never handed over), and `bytes()` for
 * bodies a provider may buffer.
 */
function credentialBody(
  data: Uint8Array | string | undefined,
  stream: EncodedBody["stream"],
): CredentialBody | undefined {
  if (data === undefined && !stream) return undefined;
  const bytes =
    typeof data === "string" ? new TextEncoder().encode(data) : data;
  const size = bytes ? bytes.byteLength : stream?.length;
  const digests = new Map<string, Promise<Uint8Array>>();
  return {
    size,
    digest(algorithm) {
      if (!HASHES.has(algorithm))
        throw new ExtensionError(
          "BAD_REQUEST",
          `Unsupported digest algorithm ${algorithm}. Use sha256, sha384, sha512, sha1 or md5.`,
        );
      let digest = digests.get(algorithm);
      if (!digest) {
        digest = (async () => {
          const hash = createHash(algorithm);
          if (bytes) hash.update(bytes);
          else
            for await (const chunk of stream!.open() as unknown as AsyncIterable<Uint8Array>)
              hash.update(chunk);
          return new Uint8Array(hash.digest());
        })();
        digests.set(algorithm, digest);
      }
      return digest;
    },
    async bytes() {
      if (bytes) return new Uint8Array(bytes);
      if ((stream?.length ?? 0) > MAX_CREDENTIAL_BODY_BYTES)
        throw new ExtensionError(
          "BAD_REQUEST",
          `The request body is streamed from a file and is larger than ${MAX_CREDENTIAL_BODY_BYTES / 1024 / 1024} MiB, so this credential code cannot read its bytes. Use digest() or a smaller upload.`,
        );
      const chunks: Uint8Array[] = [];
      for await (const chunk of stream!.open() as unknown as AsyncIterable<Uint8Array>)
        chunks.push(chunk);
      return new Uint8Array(Buffer.concat(chunks));
    },
  };
}

type BodySegment = Uint8Array | { path: string; size: number };

type EncodedBody = {
  data?: Uint8Array | string;
  /** A multipart body streamed from disk; opened afresh for every hop. */
  stream?: { length: number; open(): ReadableStream<Uint8Array> };
  contentType?: string;
};

const quoted = (value: string) =>
  value.replace(/[\r\n]/g, " ").replace(/"/g, "%22");

async function* segmentChunks(segments: readonly BodySegment[]) {
  for (const segment of segments) {
    if (segment instanceof Uint8Array) yield segment;
    else if (segment.size > 0)
      yield* createReadStream(segment.path, {
        start: 0,
        end: segment.size - 1,
      });
  }
}

async function encodeBody(
  body: HttpRequest["body"],
  openHandle: HttpHostDeps["openHandle"],
): Promise<EncodedBody> {
  if (body === undefined || body === null) return {};
  if (typeof body === "string" || body instanceof Uint8Array)
    return { data: body };
  if ("json" in body)
    return {
      data: JSON.stringify(body.json),
      contentType: "application/json",
    };
  // Multipart: file handles are streamed from disk by the host, never read into memory.
  const boundary = `----nerve${randomUUID().replaceAll("-", "")}`;
  const encoder = new TextEncoder();
  const segments: BodySegment[] = [];
  let length = 0;
  const push = (segment: BodySegment) => {
    segments.push(segment);
    length += segment instanceof Uint8Array ? segment.byteLength : segment.size;
  };
  for (const part of body.form) {
    if ("value" in part) {
      push(
        encoder.encode(
          `--${boundary}\r\nContent-Disposition: form-data; name="${quoted(part.name)}"\r\n\r\n${part.value}\r\n`,
        ),
      );
      continue;
    }
    push(
      encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="${quoted(part.name)}"; filename="${quoted(part.filename)}"\r\nContent-Type: ${(part.mediaType ?? "application/octet-stream").replace(/[\r\n]/g, "")}\r\n\r\n`,
      ),
    );
    if (part.data instanceof Uint8Array) push(part.data);
    else push(await openHandle(part.data.handle));
    push(encoder.encode("\r\n"));
  }
  push(encoder.encode(`--${boundary}--\r\n`));
  return {
    stream: {
      length,
      open: () =>
        Readable.toWeb(Readable.from(segmentChunks(segments))) as never,
    },
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function readBounded(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length"));
  const tooLarge = () =>
    new ExtensionError(
      "BAD_REQUEST",
      `The response is larger than ${Math.round(maxBytes / 1024 / 1024)} MiB; use response: { artifact } to save it as a file.`,
    );
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw tooLarge();
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const cancel = () => void reader.cancel().catch(() => undefined);
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw tooLarge();
      }
      chunks.push(value);
    }
    signal.throwIfAborted();
  } finally {
    signal.removeEventListener("abort", cancel);
  }
  return Buffer.concat(chunks, size);
}

/** `ctx.http.request`: allowed origins, SSRF guard, redirects, timeouts, size limits and credential injection. */
export function createHttp(deps: HttpHostDeps) {
  const guarded = createPinnedFetch();

  async function allowedPatterns() {
    const accounts = await deps.allSelected();
    return expandPatterns(deps.network, {
      accounts: accounts.map((account) => account.fields),
      settings: deps.settings,
    });
  }

  async function request(req: HttpRequest): Promise<HttpResponse> {
    let url: URL;
    try {
      url = new URL(req.url);
    } catch {
      throw new ExtensionError("BAD_REQUEST", `Invalid URL: ${req.url}`);
    }
    const method = (req.method ?? "GET").toUpperCase();
    const patterns = await allowedPatterns();
    const timeoutMs = Math.min(
      Math.max(req.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1),
      MAX_TIMEOUT_MS,
    );
    const signal = withTimeoutSignal(deps.signal, timeoutMs);

    // The credential to inject, resolved once; where it may go is checked per hop.
    let credential:
      | {
          account: AccountInfo;
          kind: string;
          /** Headers the injections set. */
          headers: string[];
          origins: string[];
          label: string;
        }
      | undefined;
    if (req.auth) {
      const accepted = deps.kindsOfField(req.auth.account);
      const accountKinds = accepted.flatMap((id) =>
        deps.kinds[id] ? [{ id, ...deps.kinds[id] }] : [],
      );
      if (!accountKinds.some((candidate) => candidate.auth))
        throw new ExtensionError(
          "BAD_REQUEST",
          `${deps.extensionName}: '${req.auth.account}' is not an account setting with an auth scheme.`,
        );
      const account = await deps.selected(req.auth.account);
      const selectedKind = accountKinds.find(
        (candidate) => candidate.id === account?.kind,
      );
      const kind = selectedKind ?? accountKinds[0];
      const kindId = kind.id;
      const state = account
        ? await deps.credential.state(kindId, account.id)
        : undefined;
      if (!account || state !== "ready" || !selectedKind?.auth)
        throw new ExtensionError(
          "BAD_REQUEST",
          account
            ? `The ${kind.label} "${account.name}" ${state === "failed" ? "has a credential that does not work" : state === "unavailable" ? "is unavailable" : "needs sign-in"}.`
            : `No ${accountKinds.map((candidate) => candidate.label).join(" or ")} is selected.`,
          {
            fix: `Ask the user to choose an account that is ready to use, or to sign in to it, in ${settingsPage(deps.extensionName)}.`,
          },
        );
      credential = {
        account,
        kind: kindId,
        headers: injectedHeaders(selectedKind.auth),
        origins: narrowOrigins(
          (selectedKind.origins ?? []).flatMap((origin) => {
            const filled = fillTemplate(origin, { account: account.fields });
            return filled ? [filled] : [];
          }),
          selectedKind.useOrigins,
        ),
        label: selectedKind.label,
      };
    }

    const encoded = await encodeBody(req.body, deps.openHandle);
    let data = encoded.data;
    let stream = encoded.stream;
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers ?? {}))
      headers.set(name, value);
    if (encoded.contentType && !headers.has("content-type"))
      headers.set("content-type", encoded.contentType);
    if (stream) headers.set("content-length", String(stream.length));
    headers.set("user-agent", "nerve/1.0");

    let response: Response | undefined;
    // Whether the final response came from an origin that got the credential.
    let credentialSent: boolean | undefined;
    for (let hop = 0; ; hop += 1) {
      const match = patterns.find((entry) => originMatches(url, entry.pattern));
      if (!match)
        throw new ExtensionError(
          "DENIED",
          `${deps.extensionName} may not reach ${url.origin}; its manifest does not list it under permissions.network.`,
        );
      const safe = await assertSafeHttpUrl(url, {
        allowPrivateNetwork:
          deps.allowPrivateNetwork === true || match.fromUser,
      });
      const send =
        credential && credential.origins.some((o) => originMatches(safe, o));
      credentialSent = Boolean(send);
      // A 401 may only mean the access token expired: refresh and send the hop once more.
      for (let attempt = 0; ; attempt += 1) {
        const hopHeaders = new Headers(headers);
        const attemptStartedAt = Date.now();
        const requestBody =
          method === "GET" || method === "HEAD"
            ? undefined
            : credentialBody(data, stream);
        let target = safe;
        let querySecrets: string[] = [];
        if (credential) {
          for (const name of credential.headers) hopHeaders.delete(name);
          if (send) {
            const applied = await deps.credential.apply(
              credential.kind,
              credential.account.id,
              {
                method,
                url: safe,
                headers: Object.fromEntries(hopHeaders),
                ...(requestBody ? { body: requestBody } : {}),
              },
            );
            if (!applied.ok && applied.state === "unreachable")
              throw new ExtensionError(
                "SERVER_ERROR",
                `The credential of the ${credential.label} "${credential.account.name}" could not be refreshed: its sign-in service is unreachable.`,
                { fix: "Try again later." },
              );
            if (!applied.ok)
              throw new ExtensionError(
                "BAD_REQUEST",
                `The ${credential.label} "${credential.account.name}" ${applied.state === "failed" ? "has a credential that does not work" : applied.state === "unavailable" ? "is unavailable" : "needs sign-in"}.`,
                {
                  fix: `Ask the user to sign in to the account in ${settingsPage(deps.extensionName)}.`,
                },
              );
            for (const [name, value] of Object.entries(applied.headers))
              hopHeaders.set(name, value);
            if (Object.keys(applied.query).length > 0) {
              target = new URL(safe);
              for (const [name, value] of Object.entries(applied.query))
                target.searchParams.set(name, value);
              querySecrets = Object.values(applied.query);
            }
          } else if (hop === 0)
            throw new ExtensionError(
              "DENIED",
              `The credential of the ${credential.label} is not sent to ${safe.origin}; it is only sent to ${credential.origins.join(", ") || "no origin"}.`,
            );
        }
        const fetchImpl =
          deps.allowPrivateNetwork === true || match.fromUser ? fetch : guarded;
        try {
          response = await fetchImpl(target, {
            method,
            headers: hopHeaders,
            body:
              method === "GET" || method === "HEAD"
                ? undefined
                : ((stream?.open() ?? data) as BodyInit | undefined),
            ...(stream ? { duplex: "half" } : {}),
            redirect: "manual",
            signal,
          });
        } catch (error) {
          throw querySecrets.length > 0
            ? withoutSecrets(error, querySecrets)
            : error;
        }
        if (
          response.status === 401 &&
          send &&
          credential &&
          attempt === 0 &&
          (await deps.credential.refreshAfterRejection?.(
            credential.kind,
            credential.account.id,
            attemptStartedAt,
          ))
        ) {
          await response.body?.cancel().catch(() => undefined);
          continue;
        }
        break;
      }
      if (!REDIRECT_STATUS.includes(response.status)) break;
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!location) break;
      if (hop >= MAX_REDIRECTS)
        throw new ExtensionError(
          "BAD_REQUEST",
          `More than ${MAX_REDIRECTS} redirects from ${req.url}.`,
        );
      url = new URL(location, safe);
      if (
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) &&
          method === "POST")
      ) {
        data = undefined;
        stream = undefined;
        headers.delete("content-type");
        headers.delete("content-length");
      }
    }

    // A 401/403 of a redirect target (a signed media URL) is not a verdict on the account.
    if (
      credential &&
      credentialSent &&
      (response.status === 401 || response.status === 403)
    ) {
      await response.body?.cancel().catch(() => undefined);
      const { account, label } = credential;
      const fix = `Ask the user to check the ${label} "${account.name}" and its credential in ${settingsPage(deps.extensionName)}.`;
      throw response.status === 401
        ? new ExtensionError(
            "UNAUTHORIZED",
            `${new URL(response.url || req.url).host} rejected the credential of the ${label} "${account.name}" (HTTP 401).`,
            { fix },
          )
        : new ExtensionError(
            "FORBIDDEN",
            `The ${label} "${account.name}" has no access to this resource (HTTP 403).`,
            { fix },
          );
    }

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    const base = {
      status: response.status,
      ok: response.ok,
      headers: responseHeaders,
      url: url.toString(),
    };
    let mode =
      req.response ??
      ((responseHeaders["content-type"] ?? "").includes("json")
        ? "json"
        : "text");
    const contentType = responseHeaders["content-type"] ?? "";
    // An error body, or a textual one the caller asked to keep inline, is returned as text.
    if (
      mode === "artifact" &&
      req.artifact?.inlineText &&
      (!response.ok || !contentType || TEXTUAL_CONTENT_TYPE.test(contentType))
    )
      mode = "text";
    if (mode === "artifact") {
      if (!response.ok || !response.body) {
        await response.body?.cancel().catch(() => undefined);
        return { ...base, body: undefined };
      }
      const sink = deps.artifactSink();
      const path = await sink.prepare();
      try {
        const limit = Math.min(
          req.maxBytes ?? MAX_ARTIFACT_RESPONSE_BYTES,
          MAX_ARTIFACT_RESPONSE_BYTES,
        );
        let size = 0;
        const source = Readable.fromWeb(response.body as never);
        source.on("data", (chunk: Buffer) => {
          size += chunk.byteLength;
          if (size > limit)
            source.destroy(
              new ExtensionError(
                "BAD_REQUEST",
                `The download is larger than ${Math.round(limit / 1024 / 1024)} MiB.`,
              ),
            );
        });
        await pipeline(source, createWriteStream(path, { mode: 0o600 }), {
          signal,
        });
        const name =
          req.artifact?.name ??
          (await sink.freshName(
            req.artifact?.baseName ?? "download",
            req.artifact?.extension ?? extensionFor(contentType),
          ));
        return { ...base, body: await sink.commit(path, name) };
      } catch (error) {
        await rm(path, { force: true });
        throw error;
      }
    }
    const bytes = await readBounded(
      response,
      Math.min(
        req.maxBytes ?? MAX_MEMORY_RESPONSE_BYTES,
        MAX_MEMORY_RESPONSE_BYTES,
      ),
      signal,
    );
    if (mode === "bytes") return { ...base, body: new Uint8Array(bytes) };
    const text = bytes.toString("utf8");
    if (mode === "text") return { ...base, body: text };
    if (text.trim() === "") return { ...base, body: undefined };
    try {
      return { ...base, body: JSON.parse(text) as unknown };
    } catch {
      throw new ExtensionError(
        "SERVER_ERROR",
        `${new URL(base.url).host} returned a response that is not JSON (HTTP ${response.status}).`,
      );
    }
  }

  return { request };
}
