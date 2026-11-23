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
import * as apiHost from "@nervekit/extension-api/host";
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

import { decode, encode } from "./wire.js";
import { accountTestContext, hookContext } from "../hook-context.js";

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
    (apiHost.EXTENSION_ERROR_CODES as readonly string[]).includes(
      wire.code ?? "",
    )
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
  models: {
    image: boolean;
    vision: boolean;
    text: boolean;
    defaultModel: boolean;
  };
  [field: string]: unknown;
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
    http: {
      request: ((request: unknown) =>
        call("http.request", request)) as ExtensionContext["http"]["request"],
    },
    artifacts: {
      write: (name, data, mediaType) =>
        call("artifacts.write", name, data, mediaType),
      read: (handle) => call("artifacts.read", handle),
      info: (handle) => call("artifacts.info", handle),
      freshName: (base, extension) =>
        call("artifacts.freshName", base, extension),
    },
    store: {
      get: (key) => call("store.get", key),
      set: (key, value, options) => call("store.set", key, value, options),
      delete: (key, options) => call("store.delete", key, options),
      keys: (options) => call("store.keys", options),
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
              ready: (request) => call("models.image.ready", request),
            },
          }
        : {}),
      ...(payload.models.vision
        ? {
            vision: {
              explain: (request) => call("models.vision.explain", request),
              ready: (request) => call("models.vision.ready", request),
            },
          }
        : {}),
      ...(payload.models.text
        ? {
            text: {
              complete: (request) => call("models.text.complete", request),
              ready: (request) => call("models.text.ready", request),
            },
          }
        : {}),
      ...(payload.models.defaultModel
        ? { defaultModel: () => call("models.defaultModel") }
        : {}),
    },
    progress: (section, chunk) => notify("progress", section, chunk),
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
  if (!found || apiHost.isMethodTool(found))
    throw new Error(`${definitionOf().id}: unknown tool ${name}.`);
  return found;
}

function anyToolOf(name: string): any {
  const found = definitionOf().tools?.find((entry) => entry.name === name);
  if (!found) throw new Error(`${definitionOf().id}: unknown tool ${name}.`);
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
      return apiHost.extensionDefinitionData(definitionOf());
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
      return anyToolOf(payload.tool as string).present?.(payload.output);
    case "configuration":
      return namespaceOf(payload.namespace as string).configuration?.(
        hookContext(ctx),
      );
    case "availability": {
      const available = payload.availabilityTarget as
        | { kind: "namespace"; id: string }
        | { kind: "tool"; name: string };
      const hook =
        available.kind === "namespace"
          ? namespaceOf(available.id).availability
          : definitionOf().tools?.find((tool) => tool.name === available.name)
              ?.availability;
      return await hook?.(hookContext(ctx));
    }
    case "testAccount": {
      const kind = payload.kind as string;
      const test = definitionOf().accounts?.[kind]?.test;
      if (!test)
        throw new Error(
          `${definitionOf().id}: account kind ${kind} has no test.`,
        );
      return await test(
        payload.account as AccountInfo,
        accountTestContext(ctx),
      );
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
