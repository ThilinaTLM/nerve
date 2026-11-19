/* eslint-disable @typescript-eslint/no-explicit-any -- the runtime handles definitions and wire data of any shape */
/*
 * The runtime library of a sandboxed extension: a classic script, bundled by
 * `scripts/build/copy-quick-script-assets.ts` into `sandbox-libraries/extension-runtime.js`
 * and evaluated before the extension's bundle in every extension runtime.
 *
 * It provides the extension API to the bundle (`globalThis.__nerveExtensionApi`, so the
 * bundle shares one `ExtensionError`), finds the definition the bundle registers
 * (`globalThis.__nerveExtension`) and serves one global, `__nerveExtensionInvoke(payload,
 * invocationId)`, which the host adapter (`../sandbox-adapter.ts`) invokes for every
 * operation of `ExtensionCode`. Every `ctx` service is a host call carrying the
 * invocation's token; the host answers from the real `ctx`. The wire format is shared
 * with the adapter: bytes travel as `{ $nerve: "bytes", base64 }`, errors as
 * `{ name, code?, message, fix?, kind? }`.
 */
import * as api from "@nervekit/extension-api";
import type {
  AccountInfo,
  Authorization,
  ExtensionContext,
  ExtensionDefinition,
  NamespaceDefinition,
} from "@nervekit/extension-api";

const g = globalThis as any;
// Only this library may reach the host; extension code gets `ctx`.
const host: {
  call(method: string, args: unknown, invocation: number): Promise<any>;
} = g.host;
delete g.host;
g.__nerveExtensionApi = api;

// ── UTF-8 (the engine has no TextEncoder/TextDecoder) ───────────────────────

if (typeof g.TextEncoder === "undefined") {
  g.TextEncoder = class TextEncoder {
    readonly encoding = "utf-8";
    encode(input = ""): Uint8Array {
      const text = String(input);
      const out: number[] = [];
      for (let index = 0; index < text.length; index++) {
        let code = text.charCodeAt(index);
        if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
          const next = text.charCodeAt(index + 1);
          if (next >= 0xdc00 && next <= 0xdfff) {
            code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
            index++;
          }
        }
        if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;
        if (code < 0x80) out.push(code);
        else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 63));
        else if (code < 0x10000)
          out.push(
            0xe0 | (code >> 12),
            0x80 | ((code >> 6) & 63),
            0x80 | (code & 63),
          );
        else
          out.push(
            0xf0 | (code >> 18),
            0x80 | ((code >> 12) & 63),
            0x80 | ((code >> 6) & 63),
            0x80 | (code & 63),
          );
      }
      return Uint8Array.from(out);
    }
  };
}

if (typeof g.TextDecoder === "undefined") {
  g.TextDecoder = class TextDecoder {
    readonly encoding = "utf-8";
    decode(input?: ArrayBufferView | ArrayBuffer): string {
      if (input === undefined) return "";
      const bytes = ArrayBuffer.isView(input)
        ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
        : new Uint8Array(input);
      let out = "";
      for (let index = 0; index < bytes.length;) {
        const first = bytes[index++];
        let code = 0xfffd;
        let extra = 0;
        if (first < 0x80) code = first;
        else if (first >= 0xc2 && first < 0xe0) {
          code = first & 31;
          extra = 1;
        } else if (first >= 0xe0 && first < 0xf0) {
          code = first & 15;
          extra = 2;
        } else if (first >= 0xf0 && first < 0xf5) {
          code = first & 7;
          extra = 3;
        }
        for (let step = 0; step < extra; step++) {
          const next = bytes[index];
          if (next === undefined || (next & 0xc0) !== 0x80) {
            code = 0xfffd;
            break;
          }
          code = (code << 6) | (next & 63);
          index++;
        }
        if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))
          code = 0xfffd;
        out += String.fromCodePoint(code);
      }
      return out;
    }
  };
}

// ── Wire format ──────────────────────────────────────────────────────────────

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function toBase64(bytes: Uint8Array): string {
  if (typeof g.btoa === "function") {
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000)
      binary += String.fromCharCode.apply(
        null,
        bytes.subarray(index, index + 0x8000) as unknown as number[],
      );
    return g.btoa(binary);
  }
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const b = bytes[index + 1];
    const c = bytes[index + 2];
    out += ALPHABET[a >> 2] + ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out +=
      b === undefined
        ? "=="
        : ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)] +
          (c === undefined ? "=" : ALPHABET[c & 63]);
  }
  return out;
}

function fromBase64(text: string): Uint8Array {
  if (typeof g.atob === "function") {
    const binary: string = g.atob(text);
    const out = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++)
      out[index] = binary.charCodeAt(index);
    return out;
  }
  const clean = text.replace(/=+$/, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let position = 0;
  for (let index = 0; index < clean.length; index++) {
    buffer = (buffer << 6) | ALPHABET.indexOf(clean[index]);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[position++] = (buffer >> bits) & 255;
    }
  }
  return out;
}

/** Plain data out: bytes become the tagged envelope; everything else is JSON data. */
function encode(value: unknown): unknown {
  if (value instanceof ArrayBuffer)
    return { $nerve: "bytes", base64: toBase64(new Uint8Array(value)) };
  if (ArrayBuffer.isView(value))
    return {
      $nerve: "bytes",
      base64: toBase64(
        new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
      ),
    };
  if (Array.isArray(value)) return value.map(encode);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) out[key] = encode(entry);
    return out;
  }
  return value;
}

function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decode);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.$nerve === "bytes" && typeof record.base64 === "string")
      return fromBase64(record.base64);
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(record)) out[key] = decode(entry);
    return out;
  }
  return value;
}

type WireError = {
  name: string;
  message: string;
  code?: string;
  fix?: string;
  /** `"tool"`: a host failure that is not an `ExtensionError`; rethrown as such by the host. */
  kind?: string;
};

function encodeError(error: unknown): WireError {
  if (error instanceof api.ExtensionError)
    return {
      name: "ExtensionError",
      message: error.message,
      code: error.code,
      ...(error.fix !== undefined ? { fix: error.fix } : {}),
    };
  const record = (error ?? {}) as Record<string, unknown>;
  return {
    name: typeof record.name === "string" ? record.name : "Error",
    message:
      typeof record.message === "string" ? record.message : String(error),
    ...(typeof record.code === "string" ? { code: record.code } : {}),
    ...(record.hostKind === "tool" ? { kind: "tool" } : {}),
  };
}

/** A host failure as the error the extension code catches: an `ExtensionError` when the code is one. */
function decodeError(wire: WireError): Error {
  if (
    wire.kind !== "tool" &&
    (api.EXTENSION_ERROR_CODES as readonly string[]).includes(wire.code ?? "")
  )
    return new api.ExtensionError(
      wire.code as api.ExtensionErrorCode,
      wire.message,
      {
        ...(wire.fix !== undefined ? { fix: wire.fix } : {}),
      },
    );
  const error = new Error(wire.message) as Error & Record<string, unknown>;
  error.name = wire.name;
  if (wire.code !== undefined) error.code = wire.code;
  if (wire.kind === "tool") error.hostKind = "tool";
  return error;
}

// ── ctx ──────────────────────────────────────────────────────────────────────

/** What every invocation carries besides its operation: the host's token for it and what `ctx` needs. */
type Envelope = {
  op: string;
  token: string;
  settings: Record<string, unknown>;
  models: { image: boolean; vision: boolean };
  [field: string]: unknown;
};

const neverAborted: AbortSignal = {
  aborted: false,
  reason: undefined,
  onabort: null,
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent: () => false,
  throwIfAborted() {},
};

function buildContext(
  payload: Envelope,
  invocation: number,
  pending: Set<Promise<unknown>>,
): ExtensionContext {
  const call = async (method: string, ...args: unknown[]): Promise<any> => {
    const reply = await host.call(
      method,
      { token: payload.token, args: encode(args) },
      invocation,
    );
    if (!reply.ok) throw decodeError(reply.error);
    return decode(reply.value);
  };
  /** Fire-and-forget: not counted, not awaited by the code; settled before the invocation ends. */
  const notify = (method: string, ...args: unknown[]): void => {
    const sent = call(method, ...args).catch(() => {});
    pending.add(sent);
    void sent.then(() => pending.delete(sent));
  };
  const ctx: ExtensionContext = {
    settings: {
      get: <T>(key: string) => payload.settings[key] as T | undefined,
    },
    accounts: { selected: (field) => call("accounts.selected", field) },
    http: { request: (request) => call("http.request", request) },
    artifacts: {
      write: (name, data, mediaType) =>
        call("artifacts.write", name, data, mediaType),
      read: (handle) => call("artifacts.read", handle),
      info: (handle) => call("artifacts.info", handle),
      freshName: (base, extension) =>
        call("artifacts.freshName", base, extension),
    },
    extensionStore: {
      get: (key) => call("extensionStore.get", key),
      set: (key, value, options) =>
        call("extensionStore.set", key, value, options),
      delete: (key, options) => call("extensionStore.delete", key, options),
      keys: (options) => call("extensionStore.keys", options),
    },
    text: { htmlToMarkdown: (html) => call("text.htmlToMarkdown", html) },
    authorize: (check) => call("authorize", check),
    report: {
      created: (entry) => notify("report.created", entry),
      updated: (entry) => notify("report.updated", entry),
      deleted: (entry) => notify("report.deleted", entry),
      note: (text) => notify("report.note", text),
    },
    models: {
      ...(payload.models.image
        ? {
            image: {
              generate: (request) => call("models.image.generate", request),
            },
          }
        : {}),
      ...(payload.models.vision
        ? {
            vision: {
              explain: (request) => call("models.vision.explain", request),
              ready: () => call("models.vision.ready"),
            },
          }
        : {}),
    },
    progress: (section, chunk) => notify("progress", section, chunk),
    // Cancellation is the host's native cancel of the invocation.
    signal: neverAborted,
    log: {
      debug: (message, data) => notify("log.debug", message, data),
      warn: (message, data) => notify("log.warn", message, data),
    },
  };
  return ctx;
}

// ── Operations ───────────────────────────────────────────────────────────────

let definition: ExtensionDefinition | undefined;
/** Namespace sessions, opened on the first run in the extension (one runtime serves one run). */
const sessions = new Map<string, Promise<unknown>>();
let stateful = false;

const definitionOf = (): ExtensionDefinition => {
  definition ??= g.__nerveExtension as ExtensionDefinition | undefined;
  if (!definition)
    throw new Error("The extension bundle did not register its definition.");
  return definition;
};

type Target =
  | { kind: "method"; namespace: string; path: string }
  | { kind: "tool"; name: string };

function namespaceOf(id: string): NamespaceDefinition<any> {
  const found = definitionOf().namespaces.find((entry) => entry.id === id);
  if (!found) throw new Error(`${definitionOf().id}: unknown namespace ${id}.`);
  return found;
}

function methodOf(target: Target & { kind: "method" }) {
  const found = namespaceOf(target.namespace).methods[target.path];
  if (!found)
    throw new Error(
      `${definitionOf().id}: unknown method ${target.namespace}.${target.path}.`,
    );
  return found;
}

function toolOf(name: string): any {
  const found = definitionOf().tools?.find((entry) => entry.name === name);
  if (!found || api.isMethodTool(found))
    throw new Error(`${definitionOf().id}: unknown tool ${name}.`);
  return found;
}

const asArray = (result: unknown): Authorization[] =>
  result === undefined
    ? []
    : Array.isArray(result)
      ? [...(result as Authorization[])]
      : [result as Authorization];

function sessionOf(namespace: NamespaceDefinition<any>, ctx: ExtensionContext) {
  let session = sessions.get(namespace.id);
  if (!session) {
    // The session's `ctx` is the opening call's: sessions hold plain data, not `ctx`.
    session = Promise.resolve()
      .then(() => namespace.session?.(ctx))
      .then((opened) => {
        // The host may dispose an idle runtime only while it holds no session state.
        if (opened !== undefined) stateful = true;
        return opened;
      });
    sessions.set(namespace.id, session);
  }
  return session;
}

async function perform(
  payload: Envelope,
  ctx: ExtensionContext,
): Promise<unknown> {
  const target = payload.target as Target;
  switch (payload.op) {
    case "describe":
      // The data part of the registered definition, for the host's comparison with `manifest.json`.
      return api.extensionDefinitionData(definitionOf());
    case "parse":
      return target.kind === "method"
        ? methodOf(target).parse(payload.args as unknown[])
        : toolOf(target.name).parse((payload.args as unknown[])[0] ?? {});
    case "authorize": {
      const entry =
        target.kind === "method" ? methodOf(target) : toolOf(target.name);
      return asArray(entry.authorize?.(payload.input));
    }
    case "resource":
      return target.kind === "method"
        ? methodOf(target).resource?.(payload.input)
        : undefined;
    case "run":
      if (target.kind === "tool")
        return await toolOf(target.name).run(payload.input, ctx);
      return await methodOf(target).run(
        await sessionOf(namespaceOf(target.namespace), ctx),
        payload.input,
        ctx,
      );
    case "present":
      return toolOf(payload.tool as string).present?.(payload.output);
    case "configuration":
      return namespaceOf(payload.namespace as string).configuration?.(ctx);
    case "availability": {
      const available = payload.availabilityTarget as
        | { kind: "namespace"; id: string }
        | { kind: "tool"; name: string };
      const hook =
        available.kind === "namespace"
          ? namespaceOf(available.id).availability
          : definitionOf().tools?.find((tool) => tool.name === available.name)
              ?.availability;
      return await hook?.(ctx);
    }
    case "testAccount": {
      const kind = payload.kind as string;
      const test = definitionOf().accounts?.[kind]?.test;
      if (!test)
        throw new Error(
          `${definitionOf().id}: account kind ${kind} has no test.`,
        );
      return await test(payload.account as AccountInfo, ctx);
    }
    default:
      throw new Error(`Unknown extension operation ${String(payload.op)}.`);
  }
}

g.__nerveExtensionInvoke = async (
  payload: Envelope,
  invocation: number,
): Promise<unknown> => {
  const pending = new Set<Promise<unknown>>();
  try {
    const decoded = decode(payload) as Envelope;
    const value = await perform(
      decoded,
      buildContext(decoded, invocation, pending),
    );
    while (pending.size > 0) await Promise.all([...pending]);
    return { ok: true, value: encode(value), stateful };
  } catch (error) {
    return { ok: false, error: encodeError(error), stateful };
  }
};
