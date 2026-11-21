import { ExtensionError } from "@nervekit/extension-api";
import { EXTENSION_ERROR_CODES } from "@nervekit/extension-api/host";
import { sandbox } from "@nervekit/native";
import { readSandboxLibrarySource } from "../quick-script/sandbox-library-sources.js";
import { hostCrypto } from "./credential-crypto.js";
import { decodeWire, encodeWire } from "./sandbox-adapter.js";

/*
 * Runs a credential provider (`dist/credentials.js`): one QuickJS runtime per operation, opened
 * for it and disposed after, so no memory, module state or session is shared with the extension's
 * backend runtime or between operations. The `ctx` it gets is fixed (see
 * `sandbox-runtime/credential-runtime.ts`); this side answers its host calls from the services the
 * caller grants, and refuses the ones the operation may not make.
 */

export type CredentialOperation = "signIn" | "refresh" | "apply" | "revoke";

/** What `ctx.http` of a provider asks for; the caller's service checks origins and sends it. */
export type CredentialHostHttpRequest = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | { json: unknown } | { form: Record<string, string> };
};

export type CredentialHostHttpResponse = {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: unknown;
};

/** The sign-in dialog, as the host maps it (`SignInService` interactions). */
export type CredentialHostUi = {
  link(url: string, instructions?: string): void;
  deviceCode(input: {
    userCode: string;
    verificationUri: string;
    intervalSeconds?: number;
    expiresInSeconds?: number;
  }): void;
  choose(
    message: string,
    options: { id: string; label: string; description?: string }[],
  ): Promise<string>;
  askText(
    message: string,
    options?: { secret?: boolean; placeholder?: string },
  ): Promise<string>;
  progress(message: string): void;
  loopback(state: string): Promise<{
    redirectUri: string;
    code: Promise<string>;
  }>;
};

export type CredentialHostBody = {
  digest(algorithm: string): Promise<Uint8Array>;
  bytes(): Promise<Uint8Array>;
};

/** What the caller may offer; an operation uses only what its rules allow. */
export type CredentialHostServices = {
  http?: (
    request: CredentialHostHttpRequest,
  ) => Promise<CredentialHostHttpResponse>;
  ui?: CredentialHostUi;
  body?: CredentialHostBody;
};

/** Who may call what: `apply` has no network, only `signIn` has a UI. */
const ALLOWED: Record<CredentialOperation, readonly string[]> = {
  signIn: ["crypto", "http", "ui"],
  refresh: ["crypto", "http"],
  revoke: ["crypto", "http"],
  apply: ["crypto", "body"],
};

const LIMITS: Record<CredentialOperation, sandbox.SandboxLimits> = {
  // The user may take minutes to approve a sign-in; the flow has its own timeout.
  signIn: {
    memoryBytes: 64 * 1024 * 1024,
    timeMsPerInvocation: 10 * 60_000,
    hostCallsPerInvocation: 500,
    outputBytes: 64 * 1024,
  },
  refresh: {
    memoryBytes: 64 * 1024 * 1024,
    timeMsPerInvocation: 60_000,
    hostCallsPerInvocation: 100,
    outputBytes: 64 * 1024,
  },
  revoke: {
    memoryBytes: 64 * 1024 * 1024,
    timeMsPerInvocation: 30_000,
    hostCallsPerInvocation: 50,
    outputBytes: 16 * 1024,
  },
  // Runs for every request: short, and no network to wait for.
  apply: {
    memoryBytes: 64 * 1024 * 1024,
    timeMsPerInvocation: 5_000,
    hostCallsPerInvocation: 50,
    outputBytes: 32 * 1024,
  },
};

export type CredentialRunInput = {
  /** The classic script of `dist/credentials.js`. */
  bundle: string;
  operation: CredentialOperation;
  account: { id: string; kind: string; fields: Record<string, unknown> };
  secrets: Record<string, string>;
  state?: unknown;
  /** `apply` only. */
  request?: {
    method: string;
    url: string;
    headers: Record<string, string>;
    bodySize: number | null | undefined;
  };
  services: CredentialHostServices;
  /** Cancels the operation (the user closed the dialog, shutdown). */
  signal?: AbortSignal;
  /** Tighter limits than the operation's own (tests). */
  limits?: sandbox.SandboxLimits;
};

/** What `ctx.ui` says when an operation runs without the user (the account form saved its secrets). */
export const CREDENTIAL_NEEDS_USER_MESSAGE =
  "This needs the user: sign in from the Accounts page.";

/** `host`, `path` and `query` of a URL, for code in a sandbox that has no `URL`. */
function urlParts(value: string): {
  host: string;
  path: string;
  query: [string, string][];
} {
  const url = new URL(value);
  return { host: url.host, path: url.pathname, query: [...url.searchParams] };
}

const bad = (message: string) => new ExtensionError("BAD_REQUEST", message);
const denied = (message: string) => new ExtensionError("DENIED", message);

function toWireError(error: unknown) {
  if (error instanceof ExtensionError)
    return {
      name: "ExtensionError",
      message: error.message,
      code: error.code,
      ...(error.fix !== undefined ? { fix: error.fix } : {}),
    };
  return {
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
  };
}

function fromWireError(wire: {
  name?: string;
  message?: string;
  code?: string;
  fix?: string;
}): Error {
  const message = wire.message ?? "The credential provider failed.";
  if (
    wire.name === "ExtensionError" &&
    (EXTENSION_ERROR_CODES as readonly unknown[]).includes(wire.code)
  )
    return new ExtensionError(
      wire.code as ConstructorParameters<typeof ExtensionError>[0],
      message,
      wire.fix !== undefined ? { fix: wire.fix } : {},
    );
  const error = new Error(message);
  if (wire.name) error.name = wire.name;
  return error;
}

const text = (value: unknown, what: string) => {
  if (typeof value !== "string") throw bad(`${what} must be a string.`);
  return value;
};

/** The host side of one operation: the methods its sandbox may call. */
class Session {
  readonly #loopbacks = new Map<
    string,
    { code: Promise<string>; settled: boolean }
  >();
  #nextLoopback = 0;

  constructor(private readonly input: CredentialRunInput) {}

  async serve(method: string, args: unknown[]): Promise<unknown> {
    const group = method.split(".")[0];
    if (!ALLOWED[this.input.operation].includes(group))
      throw denied(
        `${method} is not available in ${this.input.operation}${group === "http" && this.input.operation === "apply" ? ": apply has no network" : ""}.`,
      );
    const { services } = this.input;
    switch (method) {
      case "crypto.hash":
        return hostCrypto.hash(args[0], args[1]);
      case "crypto.hmac":
        return hostCrypto.hmac(args[0], args[1], args[2]);
      case "crypto.randomBytes":
        return hostCrypto.randomBytes(args[0]);
      case "crypto.sign":
        return hostCrypto.sign(args[0]);
      case "http.request": {
        if (!services.http) throw denied("There is no network here.");
        if (args[0] === null || typeof args[0] !== "object")
          throw bad("request must be an object.");
        return await services.http(args[0] as CredentialHostHttpRequest);
      }
      case "body.digest": {
        if (!services.body) throw bad("The request has no body.");
        return await services.body.digest(text(args[0], "algorithm"));
      }
      case "body.bytes": {
        if (!services.body) throw bad("The request has no body.");
        return await services.body.bytes();
      }
    }
    const ui = services.ui;
    if (!ui)
      throw new ExtensionError("BAD_REQUEST", CREDENTIAL_NEEDS_USER_MESSAGE);
    switch (method) {
      case "ui.link":
        return ui.link(text(args[0], "url"), args[1] as string | undefined);
      case "ui.deviceCode":
        return ui.deviceCode(args[0] as never);
      case "ui.choose":
        return await ui.choose(text(args[0], "message"), args[1] as never);
      case "ui.askText":
        return await ui.askText(text(args[0], "message"), args[1] as never);
      case "ui.progress":
        return ui.progress(text(args[0], "message"));
      case "ui.loopback": {
        const listener = await ui.loopback(text(args[0], "state"));
        const id = String(++this.#nextLoopback);
        this.#loopbacks.set(id, { code: listener.code, settled: false });
        return { id, redirectUri: listener.redirectUri };
      }
      case "ui.loopback.wait": {
        const entry = this.#loopbacks.get(text(args[0], "id"));
        if (!entry) throw bad("Unknown loopback listener.");
        return { code: await entry.code };
      }
    }
    throw denied(`Unknown host method ${method}.`);
  }
}

/**
 * Runs one operation of a credential provider in a fresh sandbox and returns its result as plain
 * data. Failures of the provider's code arrive as errors (an `ExtensionError` keeps its code).
 */
export async function runCredentialOperation(
  input: CredentialRunInput,
): Promise<unknown> {
  if (!sandbox.isPersistentAvailable())
    throw new Error("The native sandbox is not available.");
  const session = new Session(input);
  const token = "credential";
  const handle = await sandbox.openSandbox({
    preludes: [readSandboxLibrarySource("credential-runtime.js"), input.bundle],
    limits: { ...LIMITS[input.operation], ...input.limits },
    uncountedHostMethods: ["ui.link", "ui.deviceCode", "ui.progress"],
    onHostCall: async (method, argsJson) => {
      try {
        const parsed = JSON.parse(argsJson) as {
          token: string;
          args: unknown[];
        };
        if (parsed.token !== token)
          throw denied("The call is no longer active.");
        const value = await session.serve(
          method,
          decodeWire(parsed.args) as unknown[],
        );
        return JSON.stringify({ ok: true, value: encodeWire(value) });
      } catch (error) {
        return JSON.stringify({ ok: false, error: toWireError(error) });
      }
    },
  });
  const cancel = () => handle.cancel();
  if (input.signal?.aborted) cancel();
  input.signal?.addEventListener("abort", cancel, { once: true });
  try {
    const json = await handle.invoke(
      "__nerveCredentialInvoke",
      JSON.stringify(
        encodeWire({
          op: input.operation,
          token,
          account: input.account,
          secrets: input.secrets,
          state: input.state ?? null,
          ...(input.request
            ? {
                request: {
                  method: input.request.method,
                  url: input.request.url,
                  ...urlParts(input.request.url),
                  headers: input.request.headers,
                  body:
                    input.request.bodySize === null
                      ? null
                      : { size: input.request.bodySize },
                },
              }
            : {}),
        }),
      ),
    );
    const reply = JSON.parse(json) as
      | { ok: true; value?: unknown }
      | { ok: false; error: Parameters<typeof fromWireError>[0] };
    if (!reply.ok) throw fromWireError(reply.error);
    return decodeWire(reply.value);
  } catch (error) {
    if (error instanceof sandbox.SandboxInvocationError) {
      if (error.status === "cancelled" && input.signal?.aborted)
        throw input.signal.reason ?? error;
      throw new Error(`The credential provider failed: ${error.message}`, {
        cause: error,
      });
    }
    throw error;
  } finally {
    input.signal?.removeEventListener("abort", cancel);
    handle.dispose();
  }
}

/** The operations a credentials bundle implements, read in a throwaway sandbox that cannot reach the host. */
export async function describeCredentialBundle(
  bundle: string,
): Promise<("signIn" | "refresh" | "apply" | "revoke")[]> {
  if (!sandbox.isPersistentAvailable())
    throw new Error("The native sandbox is not available.");
  const handle = await sandbox.openSandbox({
    preludes: [readSandboxLibrarySource("credential-runtime.js"), bundle],
    limits: { memoryBytes: 32 * 1024 * 1024, timeMsPerInvocation: 5_000 },
    onHostCall: async () =>
      JSON.stringify({
        ok: false,
        error: toWireError(
          denied("The host is not available while the provider is read."),
        ),
      }),
  });
  try {
    const json = await handle.invoke(
      "__nerveCredentialInvoke",
      JSON.stringify({ op: "describe", token: "describe" }),
    );
    const reply = JSON.parse(json) as
      | { ok: true; value: { operations: never[] } }
      | { ok: false; error: Parameters<typeof fromWireError>[0] };
    if (!reply.ok) throw fromWireError(reply.error);
    return (decodeWire(reply.value) as { operations: never[] }).operations;
  } finally {
    handle.dispose();
  }
}
