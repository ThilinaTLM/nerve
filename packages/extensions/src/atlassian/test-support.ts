/*
 * Test harness for the Atlassian namespaces: a fake `ctx` (the extension API's
 * testing context) whose `http` answers like `fetch` would, and a small script
 * runner that calls the namespaces the way a `quick_script` does (parse →
 * authorize → run, JSON across the bridge, host-style errors). No host runtime.
 */
import { runInContext, createContext } from "node:vm";
import {
  ExtensionError,
  type AccountInfo,
  type Authorization,
  type AuthorizeResult,
  type ExtensionContext,
  type HttpRequest,
  type HttpResponse,
  type NamespaceDefinition,
} from "@nervekit/extension-api";
import {
  createFakeContext,
  type FakeContextRecord,
} from "@nervekit/extension-api/testing";
import { atlassianExtension } from "./manifest.js";
import { imageSize } from "./shared/image-size.js";

/** A check the policy would have seen: an operation on targets, or a direct tool such as `read`. */
export type Nested =
  | { operation: string; targets: string[]; risk: string }
  | { toolName: string; args: Record<string, unknown> };

/** The operation (`jira.issues.get`), or the direct tool name. */
export const nestedName = (request: Nested): string =>
  "operation" in request ? request.operation : request.toolName;

/** A PNG header of the given size; enough for what the extension reads (dimensions), not for decoding. */
export function fakePng(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes.set([8, 6, 0, 0, 0], 24);
  return bytes;
}

export const SITE = "https://example.atlassian.net";

export const ACCOUNT: AccountInfo = {
  id: "acct",
  name: "Acme",
  kind: "atlassian",
  fields: {
    siteUrl: SITE,
    email: "dev@example.com",
    defaultProjectKey: "APP",
    defaultSpaceKey: "DOC",
  },
};

/** What `fetch` receives: the URL and the request as `ctx.http` sent it. */
export type FetchInit = {
  method: string;
  headers: Headers;
  body: string | FormData | Uint8Array | undefined;
};
export type FetchLike = (
  input: URL,
  init: FetchInit,
) => Response | Promise<Response>;

export type HarnessOptions = {
  /** Answers every request; the test's stand-in for Jira and Confluence. */
  fetch?: FetchLike;
  /** Decides each policy check; throw to deny (the way `authorizeNested` does). */
  authorize?: (request: Nested) => void | Promise<void>;
  /** Overrides of the account's fields; `null` removes one. */
  account?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  /** Artifacts and workspace files, by handle (`artifact:a.png`, `docs/a.png`). */
  files?: Record<string, Uint8Array | string>;
};

const ALLOWED_ORIGINS = [SITE, "https://api.media.atlassian.com"];

function textOf(data: Uint8Array | string): Uint8Array {
  return typeof data === "string" ? new TextEncoder().encode(data) : data;
}

async function toInit(
  request: HttpRequest,
  files: FakeContextRecord["artifacts"],
): Promise<FetchInit> {
  const headers = new Headers(request.headers);
  let body: FetchInit["body"];
  const raw = request.body;
  if (raw === undefined) body = undefined;
  else if (typeof raw === "string" || raw instanceof Uint8Array) body = raw;
  else if ("json" in raw) {
    body = JSON.stringify(raw.json);
    if (!headers.has("content-type"))
      headers.set("content-type", "application/json");
  } else {
    const form = new FormData();
    for (const part of raw.form) {
      if ("value" in part) form.append(part.name, part.value);
      else {
        const bytes =
          part.data instanceof Uint8Array
            ? part.data
            : (files.get(part.data.handle)?.bytes ?? new Uint8Array());
        form.append(
          part.name,
          new Blob([bytes as BlobPart], {
            type: part.mediaType ?? "application/octet-stream",
          }),
          part.filename,
        );
      }
    }
    body = form;
  }
  return { method: (request.method ?? "GET").toUpperCase(), headers, body };
}

/** `fetch`'s `Response` as the host's `ctx.http` returns it, including its 401/403 errors. */
async function toHttpResponse(
  request: HttpRequest,
  response: Response,
  url: URL,
  write: ExtensionContext["artifacts"]["write"],
): Promise<HttpResponse> {
  if (request.auth && (response.status === 401 || response.status === 403)) {
    await response.body?.cancel();
    throw response.status === 401
      ? new ExtensionError(
          "UNAUTHORIZED",
          `${url.host} rejected the credential of the Atlassian account "Acme" (HTTP 401).`,
          { fix: "Ask the user to check the credential in Settings." },
        )
      : new ExtensionError(
          "FORBIDDEN",
          `The Atlassian account "Acme" has no access to this resource (HTTP 403).`,
        );
  }
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => (headers[key] = value));
  const base = {
    status: response.status,
    ok: response.ok,
    headers,
    url: url.toString(),
  };
  let mode =
    request.response ??
    ((headers["content-type"] ?? "").includes("json") ? "json" : "text");
  if (typeof mode === "object" && "artifactFor" in mode) {
    const name = response.ok
      ? await mode.artifactFor(headers["content-type"] ?? "")
      : undefined;
    mode = name === undefined ? "text" : { artifact: name };
  }
  if (typeof mode === "object") {
    if (!response.ok) return { ...base, body: undefined };
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      ...base,
      body: await write(mode.artifact, bytes, headers["content-type"]),
    };
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (mode === "bytes") return { ...base, body: bytes };
  const text = new TextDecoder().decode(bytes);
  if (mode === "text") return { ...base, body: text };
  return { ...base, body: text.trim() ? JSON.parse(text) : undefined };
}

type Method = NamespaceDefinition<unknown>["methods"][string];

const namespaces = new Map(
  atlassianExtension.namespaces.map((namespace) => [namespace.id, namespace]),
);

function authorizationsOf(
  result: AuthorizeResult,
  operation: string,
  risk: string,
): Nested[] {
  const list: readonly Authorization[] =
    result === undefined
      ? []
      : Array.isArray(result)
        ? result
        : [result as Authorization];
  return list.map((authorization) =>
    "toolName" in authorization
      ? { toolName: authorization.toolName, args: authorization.args }
      : {
          operation: authorization.operation ?? operation,
          targets: authorization.targets.map(
            (target: string | { value: string }) =>
              typeof target === "string" ? target : target.value,
          ),
          risk: authorization.risk ?? risk,
        },
  );
}

/** `jira.issues.get(options: …)`: the declaration an argument error ends with. */
function declarationLine(namespace: string, path: string, method: Method) {
  const signature = method.signature.replace(/^\/\*\*[\s\S]*?\*\/\s*/, "");
  const name = path.split(".").pop() as string;
  return `${namespace}.${path}${signature.slice(name.length)}`;
}

/** What a script sees of a failed call: `error.code`, and the host's wording. */
function hostFailure(error: unknown, resource: string): Error {
  const code =
    error instanceof ExtensionError
      ? error.code
      : (error as { code?: string } | null)?.code === "ENOENT"
        ? "NOT_FOUND"
        : "BAD_REQUEST";
  const fix = error instanceof ExtensionError ? error.fix : undefined;
  const message =
    code === "FORBIDDEN" && resource
      ? `no access to ${resource}`
      : `${error instanceof Error ? error.message : String(error)}${fix ? ` ${fix}` : ""}`;
  return Object.assign(new Error(message), { name: "HostError", code });
}

export type RunResult = {
  /** Output lines, the error, the footer lists and a `jira 2 calls (…)` line, as a `quick_script` result reads. */
  content: string;
  exitCode: number;
  /** What the run listed in its footer. */
  details: { created: string[]; updated: string[]; deleted: string[] };
  /** The SDK calls made: `jira.issues.get`, with how each ended. */
  hostCalls: { method: string; outcome: "completed" | "failed" | "denied" }[];
};

export function createHarness(options: HarnessOptions = {}) {
  const account: AccountInfo = {
    ...ACCOUNT,
    fields: Object.fromEntries(
      Object.entries({ ...ACCOUNT.fields, ...options.account }).filter(
        ([, value]) => value !== null,
      ),
    ),
  };
  /** Policy checks in the order they were made. */
  const authorized: Nested[] = [];
  const authorize = async (request: Nested) => {
    authorized.push(request);
    await options.authorize?.(request);
  };
  const { ctx: fake, record } = createFakeContext({
    settings: {
      account: account.id,
      jira: true,
      confluence: true,
      ...options.settings,
    },
    accounts: { account },
    authorize: (check) =>
      authorize({
        operation: check.operation,
        targets: [...check.targets],
        risk: check.risk,
      }),
    http: async (request) => {
      if (!options.fetch) throw new Error(`Unexpected request: ${request.url}`);
      const url = new URL(request.url);
      if (!ALLOWED_ORIGINS.includes(url.origin))
        throw new ExtensionError("DENIED", `${url.origin} is not allowed.`);
      if (request.auth?.account !== "account")
        throw new Error(`Request without the account: ${request.url}`);
      if (
        Object.keys(request.headers ?? {}).some((name) =>
          /^authorization$/i.test(name),
        )
      )
        throw new Error("The extension must not set credentials itself.");
      const init = await toInit(request, record.artifacts);
      let current = url;
      let response = await options.fetch(current, init);
      // Like the host: redirects are followed, without the credential past the first hop.
      for (
        let hops = 0;
        [301, 302, 303, 307, 308].includes(response.status) &&
        response.headers.get("location") &&
        hops < 5;
        hops += 1
      ) {
        current = new URL(response.headers.get("location")!, current);
        if (!ALLOWED_ORIGINS.includes(current.origin))
          throw new ExtensionError(
            "DENIED",
            `${current.origin} is not allowed.`,
          );
        response = await options.fetch(current, {
          ...init,
          headers: new Headers(),
          body: undefined,
        });
      }
      return await toHttpResponse(
        request,
        response,
        current,
        ctx.artifacts.write,
      );
    },
  });
  const ctx = fake;
  // Like the host: size from the stored file (any handle), dimensions of PNG/JPEG by extension.
  ctx.artifacts.info = async (handle) => {
    const stored = record.artifacts.get(handle);
    if (!stored) throw new Error(`file not found: ${handle}`);
    const mediaType = /\.png$/i.test(handle)
      ? "image/png"
      : /\.jpe?g$/i.test(handle)
        ? "image/jpeg"
        : /\.svg$/i.test(handle)
          ? "image/svg+xml"
          : stored.mediaType;
    const size =
      mediaType === "image/png" || mediaType === "image/jpeg"
        ? imageSize(stored.bytes)
        : undefined;
    return {
      handle,
      name: stored.name,
      bytes: stored.bytes.byteLength,
      mediaType,
      ...size,
    };
  };
  for (const [handle, data] of Object.entries(options.files ?? {})) {
    record.artifacts.set(handle, {
      bytes: textOf(data),
      mediaType: "application/octet-stream",
      name: handle
        .replace(/^artifact:/, "")
        .split("/")
        .pop()!,
    });
  }

  const sessions = new Map<string, Promise<unknown>>();
  const hostCalls: RunResult["hostCalls"] = [];

  /** One SDK call: parse → authorize → run, like the host's `prepare`/`run`. */
  async function call(
    namespaceId: string,
    path: string,
    args: unknown[],
  ): Promise<unknown> {
    const namespace = namespaces.get(namespaceId);
    const method = namespace?.methods[path];
    if (!namespace || !method)
      throw hostFailure(
        new Error(`Unknown method '${namespaceId}.${path}'.`),
        "",
      );
    const name = `${namespaceId}.${path}`;
    let input: unknown;
    try {
      input = method.parse(args);
    } catch (error) {
      hostCalls.push({ method: name, outcome: "failed" });
      const failure = hostFailure(error, "");
      if (!(error instanceof ExtensionError))
        failure.message += ` Declaration: ${declarationLine(namespaceId, path, method)}`;
      throw failure;
    }
    const declared = method.authorize?.(input);
    const first = Array.isArray(declared) ? declared[0] : declared;
    const resource = method.resource?.(input) ?? first?.summary ?? "";
    try {
      for (const check of authorizationsOf(
        method.authorize?.(input),
        name,
        method.risk,
      ))
        await authorize(check);
    } catch (error) {
      hostCalls.push({ method: name, outcome: "denied" });
      throw hostFailure(error, "");
    }
    try {
      let session = sessions.get(namespaceId);
      if (!session) {
        session = Promise.resolve(namespace.session?.(ctx));
        sessions.set(namespaceId, session);
      }
      const value = await method.run(await session, input, ctx);
      hostCalls.push({ method: name, outcome: "completed" });
      return value;
    } catch (error) {
      hostCalls.push({ method: name, outcome: "failed" });
      throw hostFailure(error, resource);
    }
  }

  /** `jira.issues.get(...)` for tests that call methods directly. */
  const api = (namespaceId: string) =>
    new Proxy(
      {},
      {
        get: (_target, group: string) =>
          new Proxy((...args: unknown[]) => call(namespaceId, group, args), {
            get:
              (_t, name: string) =>
              (...args: unknown[]) =>
                call(namespaceId, `${group}.${name}`, args),
          }),
      },
    ) as Record<string, (...args: unknown[]) => Promise<unknown>> &
      Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>;

  /** Runs a script like `quick_script`: the SDK globals, `storage`, `files`, `console.log` and a top-level `return`. */
  async function run(code: string): Promise<RunResult> {
    const output: string[] = [];
    const sandbox = createContext({
      console: {
        log: (...parts: unknown[]) =>
          output.push(
            parts
              .map((part) =>
                typeof part === "object" && part !== null
                  ? JSON.stringify(part)
                  : String(part),
              )
              .join(" "),
          ),
      },
      __host: async (method: string, argsJson: string) => {
        const [namespaceId, ...rest] = method.split(".");
        try {
          const value = await call(
            namespaceId,
            rest.join("."),
            JSON.parse(argsJson) as unknown[],
          );
          return JSON.stringify(value === undefined ? null : value);
        } catch (error) {
          const failure = error as Error & { code?: string };
          throw new Error(`[${failure.code}] ${failure.message}`, {
            cause: error,
          });
        }
      },
      __files: {
        read: async (handle: string) => {
          const file = record.artifacts.get(handle);
          if (!file) throw new Error(`file not found: ${handle}`);
          return new TextDecoder().decode(file.bytes);
        },
        readBytes: async (handle: string) => {
          const file = record.artifacts.get(handle);
          if (!file) throw new Error(`file not found: ${handle}`);
          return [...file.bytes];
        },
        write: async (name: string, data: string) =>
          (await ctx.artifacts.write(name, data)).handle,
      },
    });
    const globals = [...namespaces.values()]
      .filter((namespace) => Object.keys(namespace.methods).length > 0)
      .map((namespace) => {
        const body = Object.keys(namespace.methods)
          .map((path) => {
            const parts = path.split(".");
            return `    ${JSON.stringify(parts.join("."))}`;
          })
          .join(",\n");
        return `  globalThis.${namespace.id} = nest(${body ? `[\n${body}\n  ]` : "[]"}, ${JSON.stringify(namespace.id)});`;
      })
      .join("\n");
    runInContext(
      `
      const call = async (method, args) => {
        try {
          return JSON.parse(await __host(method, JSON.stringify(args ?? [])));
        } catch (error) {
          const match = /^\\[([A-Z_]+)\\] ([\\s\\S]*)$/.exec(error.message);
          if (match) { error.name = "HostError"; error.code = match[1]; error.message = match[2]; }
          throw error;
        }
      };
      const nest = (paths, product) => {
        const root = {};
        for (const path of paths) {
          const parts = path.split(".");
          let target = root;
          for (const part of parts.slice(0, -1)) target = target[part] ??= {};
          target[parts.at(-1)] = (...args) => call(product + "." + path, args);
        }
        return root;
      };
${globals}
      globalThis.files = {
        read: async (handle, options) =>
          options && options.as === "bytes"
            ? Uint8Array.from(await __files.readBytes(handle))
            : __files.read(handle),
        write: (name, data) => __files.write(name, data),
      };
      const isFlat = (row) => row !== null && typeof row === "object" && !Array.isArray(row) &&
        Object.values(row).every((v) => v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean");
      const cellText = (v) => v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v).replace(/\\s*\\n\\s*/g, " ");
      globalThis.__nerveReturn = (value) => {
        if (value === undefined) return;
        let text;
        if (typeof value === "string") text = value;
        else if (Array.isArray(value) && value.length > 0 && value.every(isFlat)) {
          const columns = [];
          for (const row of value) for (const key of Object.keys(row)) if (!columns.includes(key)) columns.push(key);
          text = [columns.join(" | "), ...value.map((row) => columns.map((c) => cellText(row[c])).join(" | "))].join("\\n");
        } else text = JSON.stringify(value) ?? String(value);
        console.log(text);
      };
      `,
      sandbox,
    );
    runInContext(PRELUDE, sandbox);
    let error: string | undefined;
    try {
      await (runInContext(
        `(async () => { __nerveReturn(await (async () => {${code}\n})()); })()`,
        sandbox,
      ) as Promise<void>);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    const lists = (
      [
        ["Created", record.created],
        ["Updated", record.updated],
        ["Deleted", record.deleted],
      ] as const
    )
      .filter(([, items]) => items.length > 0)
      .map(([label, items]) => `${label}: ${items.join(", ")}`);
    const byProduct = new Map<string, Map<string, number>>();
    for (const { method } of hostCalls) {
      const [product, ...rest] = method.split(".");
      const counts = byProduct.get(product) ?? new Map<string, number>();
      counts.set(rest.join("."), (counts.get(rest.join(".")) ?? 0) + 1);
      byProduct.set(product, counts);
    }
    const footer = [
      ...[...byProduct].map(([product, counts]) => {
        const total = [...counts.values()].reduce((a, b) => a + b, 0);
        return `${product} ${total} call${total === 1 ? "" : "s"} (${[...counts].map(([n, c]) => `${n} ${c}`).join(", ")})`;
      }),
      `exit ${error ? 1 : 0}`,
    ].join(" · ");
    return {
      content: [
        ...output,
        ...(error ? [error] : []),
        ...lists,
        ...record.notes,
        footer,
      ].join("\n"),
      exitCode: error ? 1 : 0,
      details: {
        created: [...record.created],
        updated: [...record.updated],
        deleted: [...record.deleted],
      },
      hostCalls,
    };
  }

  return {
    ctx,
    record,
    authorized,
    run,
    call,
    hostCalls,
    jira: api("jira"),
    confluence: api("confluence"),
    atlassian: api("atlassian"),
  };
}

const PRELUDE = atlassianExtension.prelude ?? "";

/** The JSON a script returned: everything before the footer line. */
export function returned(content: string | undefined) {
  const text = content ?? "";
  return JSON.parse(text.slice(0, text.lastIndexOf("\njira ")));
}
