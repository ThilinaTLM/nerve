/* eslint-disable @typescript-eslint/no-explicit-any -- the runtime handles provider definitions and wire data of any shape */
/*
 * The runtime library of a credential provider's sandbox: a classic script, bundled by
 * `scripts/build/copy-quick-script-assets.ts` into `sandbox-libraries/credential-runtime.js` and
 * evaluated before the extension's `dist/credentials.js`. The host opens a fresh runtime for
 * every operation and disposes it after, so nothing is shared with the extension's backend
 * runtime or between operations.
 *
 * It provides the extension API to the bundle (`globalThis.__nerveExtensionApi`), finds the
 * provider the bundle registers (`globalThis.__nerveCredentialProvider`) and serves one global,
 * `__nerveCredentialInvoke`, which `../credential-sandbox.ts` invokes. The `ctx` is fixed:
 * `account`, `secrets`, `state`, `crypto`, and per operation `http`, `ui`, `request`. Every
 * service is a host call; the host refuses the ones an operation may not make (`apply` has no
 * network, only `signIn` has `ui`).
 */
import * as api from "@nervekit/extension-api";
import * as apiHost from "@nervekit/extension-api/host";
import type {
  CredentialProviderDefinition,
  CredentialRequestBody,
} from "@nervekit/extension-api";
import { decode, encode } from "./wire.js";

const g = globalThis as any;
const host: {
  call(method: string, args: unknown, invocation: number): Promise<any>;
} = g.host;
delete g.host;
g.__nerveExtensionApi = api;

type WireError = {
  name: string;
  message: string;
  code?: string;
  fix?: string;
};

const encodeError = (error: unknown): WireError => {
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
  };
};

const decodeError = (wire: WireError): Error => {
  if (
    (apiHost.EXTENSION_ERROR_CODES as readonly string[]).includes(
      wire.code ?? "",
    )
  )
    return new api.ExtensionError(
      wire.code as api.ExtensionErrorCode,
      wire.message,
      wire.fix !== undefined ? { fix: wire.fix } : {},
    );
  const error = new Error(wire.message) as Error & Record<string, unknown>;
  error.name = wire.name;
  if (wire.code !== undefined) error.code = wire.code;
  return error;
};

type Envelope = {
  op: "signIn" | "refresh" | "apply" | "revoke" | "describe";
  token: string;
  account: unknown;
  secrets: Record<string, string>;
  state: unknown;
  request?: {
    method: string;
    url: string;
    host: string;
    path: string;
    query: [string, string][];
    headers: Record<string, string>;
    body: { size: number | undefined } | null;
  };
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

const providerOf = (): CredentialProviderDefinition => {
  const provider = g.__nerveCredentialProvider as
    | CredentialProviderDefinition
    | undefined;
  if (!provider)
    throw new Error("The credentials bundle did not register its provider.");
  return provider;
};

function buildContext(payload: Envelope, invocation: number): any {
  const call = async (method: string, ...args: unknown[]): Promise<any> => {
    const reply = await host.call(
      method,
      { token: payload.token, args: encode(args) },
      invocation,
    );
    if (!reply.ok) throw decodeError(reply.error);
    return decode(reply.value);
  };
  const crypto = {
    hash: (algorithm: string, data: unknown) =>
      call("crypto.hash", algorithm, data),
    hmac: (algorithm: string, key: unknown, data: unknown) =>
      call("crypto.hmac", algorithm, key, data),
    randomBytes: (length: number) => call("crypto.randomBytes", length),
    sign: (input: unknown) => call("crypto.sign", input),
  };
  const base = {
    account: payload.account,
    secrets: payload.secrets,
    state: payload.state,
    crypto,
  };
  const http = { request: (request: unknown) => call("http.request", request) };
  const notify = (method: string, ...args: unknown[]) => {
    void call(method, ...args).catch(() => {});
  };
  switch (payload.op) {
    case "signIn":
      return {
        ...base,
        http,
        signal: neverAborted,
        ui: {
          showLink: (url: string, instructions?: string) =>
            notify("ui.link", url, instructions),
          showDeviceCode: (input: unknown) => notify("ui.deviceCode", input),
          choose: (message: string, options: unknown) =>
            call("ui.choose", message, options),
          askText: (message: string, options?: unknown) =>
            call("ui.askText", message, options),
          progress: (message: string) => notify("ui.progress", message),
          loopback: async (options?: unknown) => {
            const listener = await call("ui.loopback", options);
            return {
              redirectUri: listener.redirectUri as string,
              state: listener.state as string,
              wait: () => call("ui.loopback.wait", listener.id),
            };
          },
        },
      };
    case "refresh":
    case "revoke":
      return { ...base, http, signal: neverAborted };
    case "apply": {
      const requested = payload.request!;
      const body: CredentialRequestBody | undefined = requested.body
        ? {
            size: requested.body.size,
            digest: (algorithm) => call("body.digest", algorithm),
            bytes: () => call("body.bytes"),
          }
        : undefined;
      return {
        ...base,
        request: {
          method: requested.method,
          url: requested.url,
          host: requested.host,
          path: requested.path,
          query: requested.query,
          headers: requested.headers,
          body,
        },
      };
    }
    default:
      throw new Error(`Unknown credential operation ${String(payload.op)}.`);
  }
}

g.__nerveCredentialInvoke = async (
  payload: Envelope,
  invocation: number,
): Promise<unknown> => {
  try {
    const decoded = decode(payload) as Envelope;
    const provider = providerOf();
    if (decoded.op === "describe")
      return {
        ok: true,
        value: encode({ operations: apiHost.credentialOperations(provider) }),
      };
    const operation = provider[decoded.op];
    if (typeof operation !== "function")
      throw new Error(`The credential provider has no ${decoded.op}.`);
    const value = await (operation as (ctx: unknown) => unknown)(
      buildContext(decoded, invocation),
    );
    return { ok: true, value: encode(value) };
  } catch (error) {
    return { ok: false, error: encodeError(error) };
  }
};
