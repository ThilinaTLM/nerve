import {
  ExtensionError,
  type AccountInfo,
  type AccountTestResult,
  type Authorization,
  type Availability,
  type ExtensionContext,
  type ExtensionDefinition,
} from "@nervekit/extension-api";
import { EXTENSION_ERROR_CODES } from "@nervekit/extension-api/host";
import { sandbox } from "@nervekit/native";
import { ToolExecutionError } from "../execution/index.js";
import { readSandboxLibrarySource } from "../quick-script/sandbox-library-sources.js";
import {
  inProcessExtensionCode,
  type AvailabilityTarget,
  type CodeCall,
  type CodePresentation,
  type CodeTarget,
  type ExtensionCode,
  type ExtensionCodeAdapter,
  type ExtensionCodeHost,
} from "./code-adapter.js";

/*
 * The sandbox adapter: an extension's code runs in a persistent QuickJS runtime
 * (one per extension per run), the host serves its `ctx` from the real one.
 * The wire format is shared with `sandbox-runtime/extension-runtime.ts`.
 */

/** Host calls that are fire-and-forget: they do not count against an invocation's budget. */
const UNCOUNTED_METHODS = [
  "progress",
  "report.created",
  "report.updated",
  "report.deleted",
  "report.note",
  "log.debug",
  "log.warn",
];

// ── Wire format ──────────────────────────────────────────────────────────────

const toBase64 = (bytes: Uint8Array) =>
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString(
    "base64",
  );

/** Plain data out: bytes become `{ $nerve: "bytes", base64 }`. */
export function encodeWire(value: unknown): unknown {
  if (value instanceof ArrayBuffer)
    return { $nerve: "bytes", base64: toBase64(new Uint8Array(value)) };
  if (ArrayBuffer.isView(value))
    return {
      $nerve: "bytes",
      base64: toBase64(
        new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
      ),
    };
  if (Array.isArray(value)) return value.map(encodeWire);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value))
      out[key] = encodeWire(entry);
    return out;
  }
  return value;
}

export function decodeWire(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeWire);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.$nerve === "bytes" && typeof record.base64 === "string") {
      const bytes = Buffer.from(record.base64, "base64");
      return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length);
    }
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(record))
      out[key] = decodeWire(entry);
    return out;
  }
  return value;
}

type WireError = {
  name?: string;
  message?: string;
  code?: string;
  fix?: string;
  kind?: string;
};

const isExtensionErrorCode = (code: unknown) =>
  (EXTENSION_ERROR_CODES as readonly unknown[]).includes(code);

function toWireError(error: unknown): WireError {
  if (error instanceof ExtensionError)
    return {
      name: "ExtensionError",
      message: error.message,
      code: error.code,
      ...(error.fix !== undefined ? { fix: error.fix } : {}),
    };
  if (error instanceof ToolExecutionError)
    return {
      name: error.name,
      message: error.message,
      code: error.code,
      kind: "tool",
    };
  return {
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
  };
}

/** The error the in-process path would have thrown for the failure the sandbox reported. */
function fromWireError(wire: WireError): Error {
  const message = wire.message ?? "Extension code failed.";
  if (wire.kind === "tool" && typeof wire.code === "string")
    return new ToolExecutionError(wire.code, message, {}, false);
  if (wire.name === "ExtensionError" && isExtensionErrorCode(wire.code))
    return new ExtensionError(
      wire.code as ConstructorParameters<typeof ExtensionError>[0],
      message,
      wire.fix !== undefined ? { fix: wire.fix } : {},
    );
  const error = new Error(message);
  if (wire.name) error.name = wire.name;
  return error;
}

// ── Services the sandbox may call ────────────────────────────────────────────

type Service = (ctx: ExtensionContext, args: unknown[]) => unknown;

const text = (value: unknown, what: string): string => {
  if (typeof value !== "string")
    throw new ExtensionError("BAD_REQUEST", `${what} must be a string.`);
  return value;
};
const optionalText = (value: unknown, what: string) =>
  value === undefined || value === null ? undefined : text(value, what);
const record = (value: unknown, what: string): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new ExtensionError("BAD_REQUEST", `${what} must be an object.`);
  return value as Record<string, unknown>;
};
/** `{ ifRevision }` from a call's options argument; `{}` when absent. */
const ifRevisionOf = (options: unknown): { ifRevision?: number } => {
  const value = (
    options === undefined || options === null ? {} : record(options, "options")
  ).ifRevision;
  if (value === undefined || value === null) return {};
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0)
    throw new ExtensionError(
      "BAD_REQUEST",
      "ifRevision must be a non-negative integer.",
    );
  return { ifRevision: value };
};
const modelService = <T>(service: T | undefined, name: string): T => {
  if (!service)
    throw new ExtensionError(
      "DENIED",
      `${name} is not available to this extension.`,
    );
  return service;
};

/** Every host method the sandbox's `ctx` maps to; anything else is refused. */
const SERVICES: Record<string, Service> = {
  "accounts.selected": (ctx, [field]) =>
    ctx.accounts.selected(text(field, "field")),
  "http.request": (ctx, [request]) =>
    ctx.http.request(record(request, "request") as never),
  "artifacts.write": (ctx, [name, data, mediaType]) =>
    ctx.artifacts.write(
      text(name, "name"),
      typeof data === "string" ? data : (data as Uint8Array),
      optionalText(mediaType, "mediaType"),
    ),
  "artifacts.read": (ctx, [handle]) =>
    ctx.artifacts.read(text(handle, "handle")),
  "artifacts.info": (ctx, [handle]) =>
    ctx.artifacts.info(text(handle, "handle")),
  "artifacts.freshName": (ctx, [base, extension]) =>
    ctx.artifacts.freshName(text(base, "base"), text(extension, "extension")),
  "text.htmlToMarkdown": (ctx, [html]) =>
    ctx.text.htmlToMarkdown(text(html, "html")),
  "extensionStore.get": (ctx, [key]) =>
    ctx.extensionStore.get(text(key, "key")),
  "extensionStore.set": (ctx, [key, value, options]) =>
    ctx.extensionStore.set(text(key, "key"), value, ifRevisionOf(options)),
  "extensionStore.delete": (ctx, [key, options]) =>
    ctx.extensionStore.delete(text(key, "key"), ifRevisionOf(options)),
  "extensionStore.keys": (ctx, [options]) => {
    const prefix = (
      options === undefined || options === null
        ? {}
        : record(options, "options")
    ).prefix;
    return ctx.extensionStore.keys(
      prefix === undefined || prefix === null
        ? {}
        : { prefix: text(prefix, "prefix") },
    );
  },
  authorize: (ctx, [check]) => ctx.authorize(record(check, "check") as never),
  "models.image.generate": (ctx, [request]) =>
    modelService(ctx.models.image, "models.image").generate(
      record(request, "request") as never,
    ),
  "models.vision.explain": (ctx, [request]) =>
    modelService(ctx.models.vision, "models.vision").explain(
      record(request, "request") as never,
    ),
  "models.vision.ready": (ctx) =>
    modelService(ctx.models.vision, "models.vision").ready(),
  "models.text.complete": (ctx, [request]) =>
    modelService(ctx.models.text, "models.text").complete(
      record(request, "request") as never,
    ),
  "models.text.ready": (ctx, [request]) =>
    modelService(ctx.models.text, "models.text").ready(
      request === undefined || request === null
        ? undefined
        : record(request, "request"),
    ),
  progress: (ctx, [section, chunk]) =>
    ctx.progress(text(section, "section"), text(chunk, "chunk")),
  "report.created": (ctx, [entry]) => ctx.report.created(text(entry, "entry")),
  "report.updated": (ctx, [entry]) => ctx.report.updated(text(entry, "entry")),
  "report.deleted": (ctx, [entry]) => ctx.report.deleted(text(entry, "entry")),
  "report.note": (ctx, [entry]) => ctx.report.note(text(entry, "text")),
  "log.debug": (ctx, [message, data]) =>
    ctx.log.debug(text(message, "message"), data),
  "log.warn": (ctx, [message, data]) =>
    ctx.log.warn(text(message, "message"), data),
};

// ── The adapter ──────────────────────────────────────────────────────────────

export type SandboxExtensionCodeOptions = {
  /** The extension's bundle: one classic script that sets `globalThis.__nerveExtension` to its definition. */
  bundle(definition: ExtensionDefinition): string;
  limits?: sandbox.SandboxLimits;
};

/** Runs the extension in a persistent sandbox runtime, opened on its first operation and disposed with the run. */
export function sandboxExtensionCode(
  options: SandboxExtensionCodeOptions,
): ExtensionCodeAdapter {
  return {
    open: (definition, host) =>
      new SandboxExtensionCode(definition, host, options),
  };
}

/**
 * Opens `bundle` in a throwaway sandbox runtime and returns the plain data of the definition it
 * registers (`extensionDefinitionData`). The bundle's top level runs, but nothing can reach the
 * host: every host call is refused. Rejects when the bundle fails to evaluate or registers nothing.
 */
export async function readSandboxedDefinitionData(options: {
  /** Names the extension in errors. */
  id: string;
  bundle: string;
  limits?: sandbox.SandboxLimits;
}): Promise<unknown> {
  if (!sandbox.isPersistentAvailable())
    throw new Error(`${options.id}: the native sandbox is not available.`);
  const handle = await sandbox.openSandbox({
    preludes: [
      readSandboxLibrarySource("extension-runtime.js"),
      options.bundle,
    ],
    limits: options.limits,
    uncountedHostMethods: [],
    onHostCall: async () =>
      JSON.stringify({
        ok: false,
        error: {
          name: "ExtensionError",
          code: "DENIED",
          message: "The host is not available while the extension is read.",
        },
      }),
  });
  try {
    const json = await handle.invoke(
      "__nerveExtensionInvoke",
      JSON.stringify({
        op: "describe",
        token: "describe",
        settings: {},
        models: { image: false, vision: false, text: false },
      }),
    );
    const reply = JSON.parse(json) as
      | { ok: true; value?: unknown }
      | { ok: false; error: WireError };
    if (!reply.ok) throw fromWireError(reply.error);
    return decodeWire(reply.value);
  } catch (error) {
    if (error instanceof sandbox.SandboxInvocationError)
      throw new Error(`${options.id}: ${error.message}`, { cause: error });
    throw error;
  } finally {
    handle.dispose();
  }
}

/**
 * The adapter a host composes: extensions `sandboxed` selects run in the
 * sandbox, the others in the host process.
 */
export function routedExtensionCode(options: {
  sandboxed(definition: ExtensionDefinition): boolean;
  sandbox: ExtensionCodeAdapter;
}): ExtensionCodeAdapter {
  return {
    open: (definition, host) =>
      (options.sandboxed(definition)
        ? options.sandbox
        : inProcessExtensionCode
      ).open(definition, host),
  };
}

type Operation = Record<string, unknown> & { op: string };

/** How long a runtime without session state may stay idle before the host releases it. */
const IDLE_DISPOSE_MS = 1_000;

/** Operations that run extension code needing no `ctx` (pure hooks): they work outside a run. */
const PURE_OPERATIONS = new Set(["parse", "authorize", "resource", "present"]);

class SandboxExtensionCode implements ExtensionCode {
  #handle: Promise<sandbox.SandboxHandle> | undefined;
  #disposed = false;
  /** Invocations in flight by token: how their host calls reach the real `ctx` (built on first use). */
  readonly #invocations = new Map<string, () => ExtensionContext>();
  #nextToken = 0;
  #inFlight = 0;
  /** The runtime holds session state: only `dispose` ends it. */
  #stateful = false;
  #idleTimer: NodeJS.Timeout | undefined;
  #detachAbort: (() => void) | undefined;
  #watching: AbortSignal | undefined;

  constructor(
    private readonly definition: ExtensionDefinition,
    private readonly host: ExtensionCodeHost,
    private readonly options: SandboxExtensionCodeOptions,
  ) {}

  #open(): Promise<sandbox.SandboxHandle> {
    this.#handle ??= (async () => {
      if (!sandbox.isPersistentAvailable())
        throw new Error(
          `${this.definition.id}: the native sandbox is not available.`,
        );
      return await sandbox.openSandbox({
        preludes: [
          readSandboxLibrarySource("extension-runtime.js"),
          this.options.bundle(this.definition),
        ],
        limits: this.options.limits,
        uncountedHostMethods: UNCOUNTED_METHODS,
        onHostCall: (method, argsJson) => this.#serve(method, argsJson),
      });
    })();
    return this.#handle;
  }

  /** Cancellation is the native cancel of what is in flight when the run's signal aborts. */
  #watch(handle: sandbox.SandboxHandle, signal: AbortSignal): void {
    if (this.#watching === signal) return;
    this.#detachAbort?.();
    const cancel = () => handle.cancel();
    if (signal.aborted) cancel();
    signal.addEventListener("abort", cancel, { once: true });
    this.#watching = signal;
    this.#detachAbort = () => {
      signal.removeEventListener("abort", cancel);
      this.#watching = undefined;
    };
  }

  /** Releases a runtime that has been idle without session state; a later operation opens a new one. */
  #scheduleIdleDispose(): void {
    clearTimeout(this.#idleTimer);
    if (this.#disposed || this.#inFlight > 0 || this.#stateful) return;
    this.#idleTimer = setTimeout(() => {
      const opening = this.#handle;
      if (this.#inFlight > 0 || this.#stateful || !opening) return;
      this.#handle = undefined;
      this.#detachAbort?.();
      this.#detachAbort = undefined;
      void opening.then((handle) => handle.dispose()).catch(() => {});
    }, IDLE_DISPOSE_MS);
    this.#idleTimer.unref();
  }

  /** Answers one host call of the sandbox from the real `ctx` of its invocation. */
  async #serve(method: string, argsJson: string): Promise<string> {
    try {
      const { token, args } = JSON.parse(argsJson) as {
        token: string;
        args: unknown[];
      };
      const context = this.#invocations.get(token);
      const service = SERVICES[method];
      if (!context || !service)
        throw new ExtensionError(
          "DENIED",
          context
            ? `Unknown host method ${method}.`
            : "The call is no longer active.",
        );
      const value = await service(context(), decodeWire(args) as unknown[]);
      return JSON.stringify({ ok: true, value: encodeWire(value) });
    } catch (error) {
      return JSON.stringify({ ok: false, error: toWireError(error) });
    }
  }

  async #invoke<T = unknown>(
    operation: Operation,
    call?: CodeCall,
  ): Promise<T> {
    if (this.#disposed)
      throw new Error(`${this.definition.id}: the run has ended.`);
    this.#inFlight++;
    clearTimeout(this.#idleTimer);
    const token = String(++this.#nextToken);
    try {
      const handle = await this.#open();
      const pure = PURE_OPERATIONS.has(operation.op);
      const settings: Record<string, unknown> = {};
      let models = { image: false, vision: false, text: false };
      let ctx: ExtensionContext | undefined;
      if (pure) {
        // Pure hooks get no `ctx`: they run outside a run (the script scan) as well.
        this.#invocations.set(token, () => {
          throw new ExtensionError(
            "DENIED",
            `ctx is not available in ${operation.op}.`,
          );
        });
      } else {
        const bound = this.host.context(call);
        ctx = bound;
        this.#invocations.set(token, () => bound);
        this.#watch(handle, bound.signal);
        for (const key of Object.keys(this.definition.settings.fields)) {
          const value = bound.settings.get(key);
          if (value !== undefined) settings[key] = value;
        }
        models = {
          image: !!bound.models.image,
          vision: !!bound.models.vision,
          text: !!bound.models.text,
        };
      }
      try {
        const json = await handle.invoke(
          "__nerveExtensionInvoke",
          JSON.stringify(encodeWire({ ...operation, token, settings, models })),
        );
        const reply = JSON.parse(json) as
          | { ok: true; value?: unknown; stateful?: boolean }
          | { ok: false; error: WireError; stateful?: boolean };
        if (reply.stateful) this.#stateful = true;
        if (!reply.ok) throw fromWireError(reply.error);
        return decodeWire(reply.value) as T;
      } catch (error) {
        if (!(error instanceof sandbox.SandboxInvocationError)) throw error;
        if (error.status === "cancelled" && ctx?.signal.aborted)
          throw ctx.signal.reason ?? error;
        throw new Error(`${this.definition.id}: ${error.message}`, {
          cause: error,
        });
      }
    } finally {
      this.#invocations.delete(token);
      this.#inFlight--;
      this.#scheduleIdleDispose();
    }
  }

  async parse(target: CodeTarget, args: unknown[]): Promise<unknown> {
    return await this.#invoke({ op: "parse", target, args });
  }

  async authorize(
    target: CodeTarget,
    input: unknown,
  ): Promise<Authorization[]> {
    return await this.#invoke({ op: "authorize", target, input });
  }

  async resource(
    target: CodeTarget,
    input: unknown,
  ): Promise<string | undefined> {
    return await this.#invoke({ op: "resource", target, input });
  }

  async run(
    target: CodeTarget,
    input: unknown,
    call: CodeCall,
  ): Promise<unknown> {
    return await this.#invoke({ op: "run", target, input }, call);
  }

  async present(
    tool: string,
    output: unknown,
  ): Promise<CodePresentation | undefined> {
    return await this.#invoke({ op: "present", tool, output });
  }

  async configuration(namespace: string): Promise<string | undefined> {
    return await this.#invoke({ op: "configuration", namespace });
  }

  async availability(
    availabilityTarget: AvailabilityTarget,
  ): Promise<Availability | undefined> {
    return await this.#invoke({ op: "availability", availabilityTarget });
  }

  async testAccount(
    kind: string,
    account: AccountInfo,
  ): Promise<AccountTestResult> {
    return await this.#invoke({ op: "testAccount", kind, account });
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    clearTimeout(this.#idleTimer);
    this.#invocations.clear();
    const opening = this.#handle;
    if (!opening) return;
    try {
      const handle = await opening;
      this.#detachAbort?.();
      handle.dispose();
    } catch {
      // It never opened; there is nothing to release.
    }
  }
}
