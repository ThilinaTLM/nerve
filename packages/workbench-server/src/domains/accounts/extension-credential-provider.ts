import {
  CREDENTIAL_NEEDS_USER_MESSAGE,
  fillTemplate,
  originMatches,
  runCredentialOperation,
  type CredentialHostHttpRequest,
  type CredentialHostHttpResponse,
  type CredentialHostServices,
  type CredentialHostUi,
  type CredentialOperation,
  type CredentialRunInput,
} from "@nervekit/tools/extension-host";
import { assertSafeHttpUrl } from "@nervekit/tools/execution";
import { ExtensionError } from "@nervekit/extension-api";
import type { SignInInteraction } from "../auth/sign-in-service.js";
import {
  CredentialTransientError,
  type AppliedCredential,
  type ApplyRequest,
  type CredentialProvider,
  type ProviderAccount,
  type ProviderCredential,
  type ProviderOutcome,
} from "./credential-provider.js";

/** The credential code of an installed extension, as the host loaded it. */
export type ExtensionCredentialCode = {
  extensionId: string;
  /** The classic script of `dist/credentials.js`. */
  bundle: string;
  /** SHA-256 of `bundle`: what consent covers and what a credential records. */
  sha256: string;
  operations: readonly CredentialOperation[];
};

export type ExtensionCredentialProviderDeps = {
  /** The code of the extension that defines the account's kind; by default what the account carries. */
  code?: (account: ProviderAccount) => ExtensionCredentialCode | undefined;
  /** SSRF-guarded fetch for the sign-in origins. */
  fetch?: typeof fetch;
  /** Tests reach a fake service on a private address. */
  allowPrivateNetwork?: boolean;
  /** Replaces the sandbox run (tests). */
  run?: (input: CredentialRunInput) => Promise<unknown>;
};

const HTTP_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_IDENTITY_ENTRIES = 16;
const MAX_IDENTITY_VALUE = 200;
const MAX_SCOPES = 100;
const MAX_APPLIED_HEADERS = 32;
const MAX_APPLIED_QUERY = 16;
const MAX_APPLIED_VALUE = 8 * 1024;

/**
 * Headers `apply` may not set: the ones that frame the request or name its destination. What it
 * can add is an authentication header or a signature, never a change of where or what is sent.
 */
const FORBIDDEN_APPLIED_HEADERS = new Set([
  "host",
  "content-length",
  "content-encoding",
  "transfer-encoding",
  "connection",
  "upgrade",
  "te",
  "trailer",
  "keep-alive",
  "expect",
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
]);
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const IDENTITY_KEY = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const CONTROL = /[\u0000-\u001f\u007f]/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function expiryOf(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const time =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Date.parse(value)
        : NaN;
  if (!Number.isFinite(time))
    throw new Error("expiresAt must be an ISO time or epoch milliseconds.");
  return new Date(time).toISOString();
}

/** Identity facts the backend may see: short plain strings only; anything else is dropped. */
export function validIdentity(
  value: unknown,
): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const identity: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (Object.keys(identity).length >= MAX_IDENTITY_ENTRIES) break;
    if (
      IDENTITY_KEY.test(key) &&
      typeof entry === "string" &&
      entry.length > 0 &&
      entry.length <= MAX_IDENTITY_VALUE &&
      !CONTROL.test(entry)
    )
      identity[key] = entry;
  }
  return Object.keys(identity).length > 0 ? identity : undefined;
}

/** What `apply` returned, reduced to headers and query parameters that are safe to add. */
export function validApplied(value: unknown): AppliedCredential {
  const result = isRecord(value) ? value : {};
  const headers: Record<string, string> = {};
  const query: Record<string, string> = {};
  if (isRecord(result.headers)) {
    for (const [name, entry] of Object.entries(result.headers)) {
      const lower = name.toLowerCase();
      if (
        !HEADER_NAME.test(name) ||
        FORBIDDEN_APPLIED_HEADERS.has(lower) ||
        lower.startsWith("proxy-") ||
        typeof entry !== "string" ||
        entry.length > MAX_APPLIED_VALUE ||
        /[\r\n\0]/.test(entry)
      )
        throw new Error(
          `apply returned a header that is not allowed: ${name}.`,
        );
      headers[lower] = entry;
    }
    if (Object.keys(headers).length > MAX_APPLIED_HEADERS)
      throw new Error("apply returned too many headers.");
  }
  if (isRecord(result.query)) {
    for (const [name, entry] of Object.entries(result.query)) {
      if (
        name.length === 0 ||
        name.length > 256 ||
        typeof entry !== "string" ||
        entry.length > MAX_APPLIED_VALUE
      )
        throw new Error(
          `apply returned a query parameter that is not allowed: ${name}.`,
        );
      query[name] = entry;
    }
    if (Object.keys(query).length > MAX_APPLIED_QUERY)
      throw new Error("apply returned too many query parameters.");
  }
  // Anything else it returned (a different url, method or body) is ignored: apply only adds.
  return { headers, query };
}

/**
 * The `ctx.http` of a provider: only to the kind's sign-in origins, through the SSRF guard, no
 * redirects followed, bounded in time and size. The response goes to the provider only.
 */
function signInHttp(
  account: ProviderAccount,
  deps: ExtensionCredentialProviderDeps,
  signal?: AbortSignal,
): NonNullable<CredentialHostServices["http"]> {
  return async (request: CredentialHostHttpRequest) => {
    let url: URL;
    try {
      url = new URL(String(request.url));
    } catch {
      throw new ExtensionError(
        "BAD_REQUEST",
        `Invalid URL: ${String(request.url)}`,
      );
    }
    const origins = (account.kind.signInOrigins ?? []).flatMap((origin) => {
      const filled = fillTemplate(origin, { account: account.fields });
      return filled ? [filled] : [];
    });
    if (!origins.some((origin) => originMatches(url, origin)))
      throw new ExtensionError(
        "DENIED",
        `The credential code of ${account.kind.label} may not reach ${url.origin}; its signInOrigins are ${origins.join(", ") || "empty"}.`,
      );
    await assertSafeHttpUrl(url, {
      allowPrivateNetwork: deps.allowPrivateNetwork === true,
    });
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers ?? {})) {
      const lower = name.toLowerCase();
      if (
        !HEADER_NAME.test(name) ||
        FORBIDDEN_APPLIED_HEADERS.has(lower) ||
        typeof value !== "string" ||
        /[\r\n\0]/.test(value)
      )
        throw new ExtensionError("BAD_REQUEST", `Header not allowed: ${name}.`);
      headers.set(lower, value);
    }
    let body: string | undefined;
    const given = request.body;
    if (typeof given === "string") body = given;
    else if (isRecord(given) && "json" in given) {
      body = JSON.stringify(given.json);
      if (!headers.has("content-type"))
        headers.set("content-type", "application/json");
    } else if (isRecord(given) && isRecord(given.form)) {
      body = new URLSearchParams(
        Object.entries(given.form).map(([key, value]) => [key, String(value)]),
      ).toString();
      if (!headers.has("content-type"))
        headers.set("content-type", "application/x-www-form-urlencoded");
    }
    const method = (request.method ?? "GET").toUpperCase();
    const timeout = AbortSignal.timeout(HTTP_TIMEOUT_MS);
    let response: Response;
    try {
      response = await (deps.fetch ?? fetch)(url, {
        method,
        headers,
        ...(body !== undefined && method !== "GET" && method !== "HEAD"
          ? { body }
          : {}),
        redirect: "manual",
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch {
      throw new ExtensionError(
        "SERVER_ERROR",
        `${url.host} could not be reached.`,
      );
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_RESPONSE_BYTES)
      throw new ExtensionError(
        "BAD_REQUEST",
        "The response is larger than 1 MiB.",
      );
    const text = buffer.toString("utf8");
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    let parsed: unknown = text;
    if (/json/i.test(responseHeaders["content-type"] ?? ""))
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    return {
      status: response.status,
      ok: response.ok,
      headers: responseHeaders,
      body: parsed,
    } satisfies CredentialHostHttpResponse;
  };
}

/** The sign-in dialog as a provider's `ctx.ui`. */
function signInUi(interaction: SignInInteraction): CredentialHostUi {
  return {
    link: (url, instructions) => {
      if (url.length > 8192 || !/^https?:\/\//i.test(url))
        throw new ExtensionError(
          "BAD_REQUEST",
          "showLink needs an http(s) URL.",
        );
      interaction.notify({
        type: "auth_url",
        url,
        ...(instructions ? { instructions: instructions.slice(0, 500) } : {}),
      });
    },
    deviceCode: (input) =>
      interaction.notify({
        type: "device_code",
        userCode: String(input.userCode).slice(0, 64),
        verificationUri: String(input.verificationUri).slice(0, 2048),
        ...(input.intervalSeconds
          ? { intervalSeconds: input.intervalSeconds }
          : {}),
        ...(input.expiresInSeconds
          ? { expiresInSeconds: input.expiresInSeconds }
          : {}),
      }),
    choose: (message, options) =>
      interaction.prompt({
        type: "select",
        message: String(message).slice(0, 500),
        options: options.map((option) => ({
          id: String(option.id),
          label: String(option.label).slice(0, 200),
          ...(option.description
            ? { description: String(option.description).slice(0, 500) }
            : {}),
        })),
      }),
    askText: (message, options) =>
      interaction.prompt({
        type: options?.secret ? "secret" : "text",
        message: String(message).slice(0, 500),
        ...(options?.placeholder
          ? { placeholder: String(options.placeholder).slice(0, 200) }
          : {}),
      }),
    progress: (message) =>
      interaction.notify({
        type: "progress",
        message: String(message).slice(0, 500),
      }),
    loopback: async (options) => {
      const listener = await interaction.listenLoopback(options);
      return {
        redirectUri: listener.redirectUri,
        state: listener.state,
        code: listener.code,
      };
    },
  };
}

/**
 * The credential provider of an extension that ships its own code (`provider: "extension"`): the
 * four operations run in a fresh sandbox each, with the fixed `ctx` of `credential-runtime.ts`.
 * The vault is its only caller; the backend, UI and agent never reach it, and what it returns
 * goes to the vault (state), the user (identity, errors in Settings) or the wire (apply output,
 * for credential origins only).
 */
export function createExtensionCredentialProvider(
  deps: ExtensionCredentialProviderDeps,
): CredentialProvider {
  const run = deps.run ?? runCredentialOperation;
  const find = (account: ProviderAccount) =>
    (deps.code ?? ((entry) => entry.credentials))(account);
  const codeOf = (account: ProviderAccount): ExtensionCredentialCode => {
    const code = find(account);
    if (!code)
      throw new Error(
        `The credential code of ${account.kind.label} is not available.`,
      );
    return code;
  };
  const input = (
    code: ExtensionCredentialCode,
    operation: CredentialOperation,
    account: ProviderAccount,
    secrets: Record<string, string>,
    extra: Partial<CredentialRunInput>,
  ): CredentialRunInput => ({
    bundle: code.bundle,
    operation,
    account: {
      id: account.id,
      kind: account.kind.kind,
      fields: account.fields,
    },
    secrets,
    services: {},
    ...extra,
  });
  const result = (
    value: unknown,
    code: ExtensionCredentialCode,
  ): ProviderOutcome => {
    if (!isRecord(value) || !("state" in value))
      throw new Error("The credential code must return { state }.");
    const expiresAt = expiryOf(value.expiresAt);
    const identity = validIdentity(value.identity);
    const scopes = Array.isArray(value.grantedScopes)
      ? value.grantedScopes
          .filter((scope): scope is string => typeof scope === "string")
          .slice(0, MAX_SCOPES)
      : undefined;
    return {
      status: "ready",
      state: value.state,
      ...(expiresAt ? { expiresAt } : {}),
      ...(identity ? { identity } : {}),
      ...(scopes ? { grantedScopes: scopes } : {}),
      codeHash: code.sha256,
    };
  };

  return {
    interactive: false,

    codeHash: (account) => find(account)?.sha256 ?? "unavailable",

    async signIn(account, { secrets, interaction }) {
      const code = codeOf(account);
      try {
        const value = await run(
          input(code, "signIn", account, secrets, {
            services: {
              http: signInHttp(account, deps, interaction?.signal),
              ...(interaction ? { ui: signInUi(interaction) } : {}),
            },
            ...(interaction ? { signal: interaction.signal } : {}),
          }),
        );
        return result(value, code);
      } catch (error) {
        // Saving the form runs signIn without the user; a provider that needs one waits for Sign in.
        if (
          !interaction &&
          error instanceof Error &&
          error.message === CREDENTIAL_NEEDS_USER_MESSAGE
        )
          return {
            status: "needs_sign_in",
            message: "Sign in from the Accounts page.",
          };
        throw error;
      }
    },

    canRefresh: (credential: ProviderCredential, account) =>
      credential.state !== undefined &&
      credential.state !== null &&
      (find(account)?.operations.includes("refresh") ?? false),

    async refresh(account, credential, signal) {
      const code = codeOf(account);
      if (!code.operations.includes("refresh"))
        return { status: "needs_sign_in", message: "Sign in again." };
      let value: unknown;
      try {
        value = await run(
          input(code, "refresh", account, credential.secrets, {
            state: credential.state,
            services: { http: signInHttp(account, deps, signal) },
            ...(signal ? { signal } : {}),
          }),
        );
      } catch {
        // Could not tell (network, 5xx, a bug): the credential stays, the next try may work.
        throw new CredentialTransientError(
          "The credential could not be refreshed.",
        );
      }
      if (isRecord(value) && value.needsSignIn === true)
        return {
          status: "needs_sign_in",
          message:
            typeof value.message === "string"
              ? value.message.slice(0, 300)
              : "Sign in again.",
        };
      try {
        return result(value, code);
      } catch {
        throw new CredentialTransientError(
          "The credential code returned an invalid credential.",
        );
      }
    },

    async apply(account, credential, request: ApplyRequest) {
      const code = codeOf(account);
      const value = await run(
        input(code, "apply", account, credential.secrets, {
          state: credential.state,
          request: {
            method: request.method,
            url: request.url.toString(),
            headers: request.headers ?? {},
            bodySize: request.body ? (request.body.size ?? undefined) : null,
          },
          services: request.body
            ? {
                body: {
                  digest: (algorithm) => request.body!.digest(algorithm),
                  bytes: () => request.body!.bytes(),
                },
              }
            : {},
        }),
      );
      return validApplied(value);
    },

    async revoke(account, credential) {
      const code = find(account);
      if (!code?.operations.includes("revoke")) return;
      await run(
        input(code, "revoke", account, credential.secrets, {
          state: credential.state,
          services: { http: signInHttp(account, deps) },
        }),
      );
    },
  };
}
