import { createHash, randomBytes } from "node:crypto";
import { accountClientIdField } from "@nervekit/contracts/extensions";
import type { AccountOAuth2Provider } from "@nervekit/extension-api";
import { assertSafeHttpUrl } from "@nervekit/tools/execution";
import type { SignInInteraction } from "../auth/sign-in-service.js";
import {
  CredentialTransientError,
  CredentialUnusableError,
  type AppliedCredential,
  type CredentialProvider,
  type ProviderAccount,
  type ProviderCredential,
  type ProviderOutcome,
} from "./credential-provider.js";

/** What the provider keeps in `CredentialBlob.state`. */
type OAuth2State = { accessToken: string; refreshToken?: string };

type Endpoints = {
  authorization?: string | undefined;
  token?: string | undefined;
  deviceAuthorization?: string | undefined;
  revocation?: string | undefined;
};

type TokenResponse = Record<string, unknown>;

export type OAuth2ProviderDeps = {
  /** SSRF-guarded fetch for the sign-in origins (token, discovery, userinfo, revocation). */
  fetch?: typeof fetch;
  /** Tests reach a fake service on a private address. */
  allowPrivateNetwork?: boolean;
  now?: () => number;
  /** Waits between device-code polls. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

const REQUEST_TIMEOUT_MS = 30_000;
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const DEFAULT_DEVICE_INTERVAL_S = 5;
const MAX_DEVICE_WAIT_MS = 15 * 60_000;
const IDENTITY_VALUE_MAX = 200;

const base64Url = (bytes: Buffer) => bytes.toString("base64url");

const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("Sign-in cancelled"));
      },
      { once: true },
    );
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function configOf(account: ProviderAccount): AccountOAuth2Provider {
  const provider = account.kind.provider;
  if (typeof provider !== "object")
    throw new Error("The account kind has no oauth2 provider.");
  return provider;
}

/** `{field}` templates filled from the account's fields. */
function fill(template: string, account: ProviderAccount): string {
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (_, key: string) => {
    const value = account.fields[key];
    if (typeof value !== "string" || !value)
      throw new Error(
        `Fill in "${account.kind.fields[key]?.label ?? key}" of the account first.`,
      );
    return value;
  });
}

function clientIdOf(account: ProviderAccount): string {
  const field = accountClientIdField(configOf(account));
  const declared = account.kind.fields[field];
  const value =
    account.fields[field] ??
    (declared?.type === "string" ? declared.default : undefined);
  if (typeof value !== "string" || !value.trim())
    throw new Error(
      `Enter the ${declared?.label ?? "client id"} of this account first.`,
    );
  return value.trim();
}

function secretOf(
  account: ProviderAccount,
  credential: Pick<ProviderCredential, "secrets">,
): string | undefined {
  const name = configOf(account).clientSecret;
  return name ? credential.secrets[name] || undefined : undefined;
}

function stateOf(credential: ProviderCredential): OAuth2State | undefined {
  const state = credential.state;
  return isRecord(state) && typeof state.accessToken === "string"
    ? {
        accessToken: state.accessToken,
        ...(typeof state.refreshToken === "string"
          ? { refreshToken: state.refreshToken }
          : {}),
      }
    : undefined;
}

function splitScopes(value: unknown): string[] | undefined {
  return typeof value === "string" && value.trim()
    ? value.split(/[\s,]+/).filter(Boolean)
    : undefined;
}

/** A value at a dotted path of a JSON document. */
function pick(document: unknown, path: string): unknown {
  let value: unknown = document;
  for (const key of path.split(".")) {
    if (!isRecord(value)) return undefined;
    value = value[key];
  }
  return value;
}

const form = (values: Record<string, string | undefined>) =>
  new URLSearchParams(
    Object.entries(values).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  ).toString();

/** An error response of the token endpoint as the outcome it means. */
function errorOutcome(body: TokenResponse): ProviderOutcome | undefined {
  if (typeof body.error !== "string") return undefined;
  const detail =
    typeof body.error_description === "string" ? body.error_description : "";
  if (body.error === "invalid_grant")
    return {
      status: "needs_sign_in",
      message: "The sign-in expired or was revoked. Sign in again.",
    };
  if (body.error === "invalid_client" || body.error === "unauthorized_client")
    return {
      status: "failed",
      message: `The service rejected this account's client id or secret${detail ? ` (${detail})` : ""}. Check them in the account's settings.`,
    };
  return {
    status: "failed",
    message: `The service refused the request: ${body.error}${detail ? ` (${detail})` : ""}.`,
  };
}

/**
 * The built-in `oauth2` provider: authorization code with PKCE (loopback redirect) and device
 * code, refresh, optional identity from a userinfo endpoint, optional revocation (RFC 7009).
 * Host code, vendor-neutral: everything service-specific is the kind's manifest data.
 */
export function createOAuth2Provider(
  deps: OAuth2ProviderDeps = {},
): CredentialProvider {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? defaultSleep;
  const discovered = new Map<string, Promise<Record<string, unknown>>>();

  /** One request to a sign-in origin: guarded, bounded; a network failure is transient. */
  async function send(
    url: string,
    init: RequestInit,
    signal?: AbortSignal,
  ): Promise<{ status: number; json: unknown; text: string }> {
    const target = await assertSafeHttpUrl(url, {
      allowPrivateNetwork: deps.allowPrivateNetwork === true,
    });
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await doFetch(target, {
        ...init,
        redirect: "manual",
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new CredentialTransientError(
        `The sign-in service at ${target.host} could not be reached.`,
      );
    }
    const text = (await response.text()).slice(0, 1_000_000);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: response.status, json, text };
  }

  async function endpointsOf(
    account: ProviderAccount,
    signal?: AbortSignal,
  ): Promise<Endpoints> {
    const config = configOf(account);
    const explicit = (value: string | undefined) =>
      value ? fill(value, account) : undefined;
    const endpoints: Endpoints = {
      authorization: explicit(config.authorizationUrl),
      token: explicit(config.tokenUrl),
      deviceAuthorization: explicit(config.deviceAuthorizationUrl),
      revocation: explicit(config.revocationUrl),
    };
    if (!config.discovery) return endpoints;
    const issuer = fill(config.discovery, account).replace(/\/+$/, "");
    let document = discovered.get(issuer);
    if (!document) {
      document = (async () => {
        const { status, json } = await send(
          `${issuer}/.well-known/openid-configuration`,
          { headers: { accept: "application/json" } },
          signal,
        );
        if (status >= 500)
          throw new CredentialTransientError(
            `The sign-in service at ${new URL(issuer).host} failed.`,
          );
        if (status !== 200 || !isRecord(json))
          throw new Error(
            `${issuer} did not return OpenID Connect discovery metadata.`,
          );
        return json;
      })();
      discovered.set(issuer, document);
      document.catch(() => discovered.delete(issuer));
    }
    const found = await document;
    const text = (key: string) =>
      typeof found[key] === "string" ? found[key] : undefined;
    return {
      authorization: endpoints.authorization ?? text("authorization_endpoint"),
      token: endpoints.token ?? text("token_endpoint"),
      deviceAuthorization:
        endpoints.deviceAuthorization ?? text("device_authorization_endpoint"),
      revocation: endpoints.revocation ?? text("revocation_endpoint"),
    };
  }

  /** Posts to the token endpoint. Network failures and 5xx are transient; the rest is the service's verdict. */
  async function tokenRequest(
    account: ProviderAccount,
    endpoint: string,
    values: Record<string, string | undefined>,
    credential: Pick<ProviderCredential, "secrets">,
    signal?: AbortSignal,
  ): Promise<TokenResponse> {
    const clientSecret = secretOf(account, credential);
    const { status, json, text } = await send(
      endpoint,
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: form({
          ...values,
          client_id: clientIdOf(account),
          ...(clientSecret ? { client_secret: clientSecret } : {}),
        }),
      },
      signal,
    );
    if (status >= 500 || status === 429)
      throw new CredentialTransientError(
        `The sign-in service at ${new URL(endpoint).host} failed (HTTP ${status}).`,
      );
    if (!isRecord(json))
      throw new Error(
        `The token endpoint at ${new URL(endpoint).host} did not answer with JSON (HTTP ${status}): ${text.slice(0, 120)}`,
      );
    return json;
  }

  /** The tokens of a successful response as a `ready` outcome. */
  function grant(
    body: TokenResponse,
    account: ProviderAccount,
    previous?: { refreshToken?: string; grantedScopes?: string[] },
  ): ProviderOutcome {
    const access = body.access_token;
    if (typeof access !== "string" || !access)
      throw new Error("The token response had no access token.");
    const refresh =
      typeof body.refresh_token === "string" && body.refresh_token
        ? body.refresh_token
        : previous?.refreshToken;
    const expiresIn = Number(body.expires_in);
    // A response without `scope` grants what was asked for (RFC 6749 §5.1).
    const granted = splitScopes(body.scope) ??
      previous?.grantedScopes ?? [...(configOf(account).scopes ?? [])];
    return {
      status: "ready",
      state: {
        accessToken: access,
        ...(refresh ? { refreshToken: refresh } : {}),
      } satisfies OAuth2State,
      grantedScopes: granted,
      ...(Number.isFinite(expiresIn) && expiresIn > 0
        ? { expiresAt: new Date(now() + expiresIn * 1000).toISOString() }
        : {}),
    };
  }

  async function identityOf(
    account: ProviderAccount,
    accessToken: string,
    signal?: AbortSignal,
  ): Promise<Record<string, string> | undefined> {
    const userinfo = configOf(account).userinfo;
    if (!userinfo) return undefined;
    try {
      const { status, json } = await send(
        fill(userinfo.url, account),
        {
          headers: {
            authorization: `Bearer ${accessToken}`,
            accept: "application/json",
          },
        },
        signal,
      );
      if (status !== 200) return undefined;
      const identity: Record<string, string> = {};
      for (const [name, path] of Object.entries(userinfo.identity)) {
        const value = pick(json, path);
        // Short plain strings only: identity is shown to the backend.
        if (
          (typeof value === "string" || typeof value === "number") &&
          String(value).length <= IDENTITY_VALUE_MAX &&
          !/[\r\n]/.test(String(value))
        )
          identity[name] = String(value);
      }
      return Object.keys(identity).length > 0 ? identity : undefined;
    } catch (error) {
      if (signal?.aborted) throw error;
      // Identity is optional: a failing userinfo endpoint does not fail the sign-in.
      return undefined;
    }
  }

  async function authorizationCode(
    account: ProviderAccount,
    credential: Pick<ProviderCredential, "secrets">,
    interaction: SignInInteraction,
    endpoints: Endpoints,
  ): Promise<ProviderOutcome> {
    if (!endpoints.authorization || !endpoints.token)
      throw new Error("The authorization endpoint is not known.");
    const config = configOf(account);
    const verifier = base64Url(randomBytes(32));
    const listener = await interaction.listenLoopback(
      config.redirectPath ? { path: config.redirectPath } : {},
    );
    const url = new URL(endpoints.authorization);
    for (const [key, value] of Object.entries({
      ...config.authorizationParams,
      response_type: "code",
      client_id: clientIdOf(account),
      redirect_uri: listener.redirectUri,
      ...(config.scopes?.length ? { scope: config.scopes.join(" ") } : {}),
      state: listener.state,
      code_challenge: base64Url(createHash("sha256").update(verifier).digest()),
      code_challenge_method: "S256",
    }))
      url.searchParams.set(key, value);
    interaction.notify({
      type: "auth_url",
      url: url.toString(),
      instructions: `Sign in to ${account.kind.label} in your browser.`,
    });
    const code = await listener.code;
    const body = await tokenRequest(
      account,
      endpoints.token,
      {
        grant_type: "authorization_code",
        code,
        redirect_uri: listener.redirectUri,
        code_verifier: verifier,
      },
      credential,
      interaction.signal,
    );
    return errorOutcome(body) ?? grant(body, account);
  }

  async function deviceCode(
    account: ProviderAccount,
    credential: Pick<ProviderCredential, "secrets">,
    interaction: SignInInteraction,
    endpoints: Endpoints,
  ): Promise<ProviderOutcome> {
    if (!endpoints.deviceAuthorization || !endpoints.token)
      throw new Error("The device authorization endpoint is not known.");
    const scopes = configOf(account).scopes;
    const signal = interaction.signal;
    const started = await send(
      endpoints.deviceAuthorization,
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: form({
          client_id: clientIdOf(account),
          ...(scopes?.length ? { scope: scopes.join(" ") } : {}),
        }),
      },
      signal,
    );
    if (started.status >= 500)
      throw new CredentialTransientError(
        `The sign-in service at ${new URL(endpoints.deviceAuthorization).host} failed.`,
      );
    const device = started.json;
    const verification = isRecord(device)
      ? (device.verification_uri ?? device.verification_url)
      : undefined;
    if (
      !isRecord(device) ||
      typeof device.device_code !== "string" ||
      typeof device.user_code !== "string" ||
      typeof verification !== "string"
    )
      return {
        status: "failed",
        message: `The service refused the device sign-in${isRecord(device) && typeof device.error_description === "string" ? `: ${device.error_description}` : "."}`,
      };
    const expiresIn = Number(device.expires_in);
    let interval =
      (Number(device.interval) > 0
        ? Number(device.interval)
        : DEFAULT_DEVICE_INTERVAL_S) * 1000;
    interaction.notify({
      type: "device_code",
      userCode: device.user_code,
      verificationUri: verification,
      intervalSeconds: interval / 1000,
      ...(expiresIn > 0 ? { expiresInSeconds: expiresIn } : {}),
    });
    const deadline =
      now() + (expiresIn > 0 ? expiresIn * 1000 : MAX_DEVICE_WAIT_MS);
    while (now() < deadline) {
      await sleep(interval, signal);
      const body = await tokenRequest(
        account,
        endpoints.token,
        { grant_type: DEVICE_GRANT, device_code: device.device_code },
        credential,
        signal,
      );
      if (body.error === "authorization_pending") continue;
      if (body.error === "slow_down") {
        interval += 5_000;
        continue;
      }
      if (body.error === "expired_token")
        return {
          status: "needs_sign_in",
          message: "The sign-in code expired.",
        };
      if (body.error === "access_denied")
        return {
          status: "needs_sign_in",
          message: "The sign-in was declined.",
        };
      return errorOutcome(body) ?? grant(body, account);
    }
    return { status: "needs_sign_in", message: "The sign-in code expired." };
  }

  return {
    interactive: true,

    async signIn(account, { secrets, interaction }) {
      if (!interaction)
        return { status: "needs_sign_in", message: "Sign in to continue." };
      const config = configOf(account);
      const credential = { secrets };
      const endpoints = await endpointsOf(account, interaction.signal);
      const flows = config.flows ?? ["authorization_code"];
      let flow = flows[0];
      if (flows.length > 1)
        flow = (await interaction.prompt({
          type: "select",
          message: "How do you want to sign in?",
          options: flows.map((id) =>
            id === "device_code"
              ? {
                  id,
                  label: "Device code",
                  description: "Enter a code on another device or browser.",
                }
              : {
                  id,
                  label: "Browser",
                  description: "Sign in in a browser on this computer.",
                },
          ),
        })) as typeof flow;
      const outcome =
        flow === "device_code"
          ? await deviceCode(account, credential, interaction, endpoints)
          : await authorizationCode(
              account,
              credential,
              interaction,
              endpoints,
            );
      if (outcome.status !== "ready") return outcome;
      const identity = await identityOf(
        account,
        (outcome.state as OAuth2State).accessToken,
        interaction.signal,
      );
      return identity ? { ...outcome, identity } : outcome;
    },

    canRefresh: (credential) => Boolean(stateOf(credential)?.refreshToken),

    requiredScopes: (account) => configOf(account).scopes ?? [],

    async refresh(account, credential, signal) {
      const state = stateOf(credential);
      if (!state?.refreshToken)
        return { status: "needs_sign_in", message: "Sign in again." };
      const endpoints = await endpointsOf(account, signal);
      if (!endpoints.token) throw new Error("The token endpoint is not known.");
      const body = await tokenRequest(
        account,
        endpoints.token,
        { grant_type: "refresh_token", refresh_token: state.refreshToken },
        credential,
        signal,
      );
      return (
        errorOutcome(body) ??
        grant(body, account, {
          refreshToken: state.refreshToken,
          ...(credential.grantedScopes
            ? { grantedScopes: credential.grantedScopes }
            : {}),
        })
      );
    },

    async apply(_account, credential): Promise<AppliedCredential> {
      const state = stateOf(credential);
      if (!state) throw new CredentialUnusableError("Sign in is required.");
      return {
        headers: { authorization: `Bearer ${state.accessToken}` },
        query: {},
      };
    },

    async revoke(account, credential) {
      const state = stateOf(credential);
      if (!state) return;
      const endpoints = await endpointsOf(account);
      if (!endpoints.revocation) return;
      const clientSecret = secretOf(account, credential);
      await send(endpoints.revocation, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form({
          token: state.refreshToken ?? state.accessToken,
          token_type_hint: state.refreshToken
            ? "refresh_token"
            : "access_token",
          client_id: clientIdOf(account),
          ...(clientSecret ? { client_secret: clientSecret } : {}),
        }),
      });
    },
  };
}
