import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
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
import { withTimeoutSignal } from "../../execution/process/abort.js";
import {
  assertSafeHttpUrl,
  createPinnedFetch,
} from "../../execution/network/network-policy.js";
import { fillTemplate, expandPatterns, originMatches } from "./network.js";
import { settingsPage } from "./errors.js";

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
      { label: string; auth?: AccountAuth; origins?: readonly string[] }
    >
  >;
  /** Kind of the account an `account` setting selects; undefined when `field` is not one. */
  kindOfField(field: string): string | undefined;
  /** The account the setting selects, when it exists. */
  selected(field: string): Promise<AccountInfo | undefined>;
  /** Every selected account of the extension, for `{account.<field>}` templates. */
  allSelected(): Promise<AccountInfo[]>;
  /** Resolved settings of the extension, for `{settings.<key>}` templates. */
  settings: Record<string, unknown>;
  secret(kind: string, id: string): Promise<string | undefined>;
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
    commit(path: string, name: string): Promise<ArtifactRef>;
  };
};

const REDIRECT_STATUS = [301, 302, 303, 307, 308];

function credentialHeader(
  auth: AccountAuth,
  account: AccountInfo,
  secret: string,
): [name: string, value: string] {
  switch (auth.scheme) {
    case "bearer":
      return ["authorization", `Bearer ${secret}`];
    case "header":
      return [auth.name.toLowerCase(), secret];
    case "basic": {
      const user = account.fields[auth.user];
      return [
        "authorization",
        `Basic ${Buffer.from(`${typeof user === "string" ? user : ""}:${secret}`, "utf8").toString("base64")}`,
      ];
    }
  }
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
          header: [string, string];
          origins: string[];
          label: string;
        }
      | undefined;
    if (req.auth) {
      const kindId = deps.kindOfField(req.auth.account);
      const kind = kindId ? deps.kinds[kindId] : undefined;
      if (!kindId || !kind?.auth)
        throw new ExtensionError(
          "BAD_REQUEST",
          `${deps.extensionName}: '${req.auth.account}' is not an account setting with an auth scheme.`,
        );
      const account = await deps.selected(req.auth.account);
      const secret = account
        ? await deps.secret(kindId, account.id)
        : undefined;
      if (!account || !secret)
        throw new ExtensionError(
          "BAD_REQUEST",
          account
            ? `The ${kind.label} "${account.name}" has no saved credential.`
            : `No ${kind.label} is selected.`,
          {
            fix: `Ask the user to choose an account with a saved credential in ${settingsPage(deps.extensionName)}.`,
          },
        );
      credential = {
        account,
        header: credentialHeader(kind.auth, account, secret),
        origins: (kind.origins ?? []).flatMap((origin) => {
          const filled = fillTemplate(origin, { account: account.fields });
          return filled ? [filled] : [];
        }),
        label: kind.label,
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
      const hopHeaders = new Headers(headers);
      const send =
        credential && credential.origins.some((o) => originMatches(safe, o));
      credentialSent = Boolean(send);
      if (credential) {
        hopHeaders.delete(credential.header[0]);
        if (send) hopHeaders.set(credential.header[0], credential.header[1]);
        else if (hop === 0)
          throw new ExtensionError(
            "DENIED",
            `The credential of the ${credential.label} is not sent to ${safe.origin}; it is only sent to ${credential.origins.join(", ") || "no origin"}.`,
          );
      }
      const fetchImpl =
        deps.allowPrivateNetwork === true || match.fromUser ? fetch : guarded;
      response = await fetchImpl(safe, {
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
    if (typeof mode === "object" && "artifactFor" in mode) {
      const name = response.ok
        ? await mode.artifactFor(responseHeaders["content-type"] ?? "")
        : undefined;
      mode = name === undefined ? "text" : { artifact: name };
    }
    if (typeof mode === "object") {
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
        return { ...base, body: await sink.commit(path, mode.artifact) };
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
