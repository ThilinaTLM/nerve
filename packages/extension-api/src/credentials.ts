/*
 * Credential providers: code an extension ships for accounts the host's built-in providers
 * (`static`, `oauth2`) cannot serve: request signing, token exchanges, login-for-session-token
 * APIs, sign-in flows Nerve has never heard of. It runs in its own sandbox, sees the account's
 * credentials, and can only hand the host headers and query parameters for the account's own
 * credential origins. The extension's backend and UI never see a credential.
 */

/** The account a provider works for. Its secrets are separate (`ctx.secrets`). */
export type CredentialAccount = {
  /** Id of the account. */
  id: string;
  /** The account kind. */
  kind: string;
  /** The kind's non-secret fields as the user filled them. */
  fields: Record<string, unknown>;
};

/** Hash and signing primitives, run by the host (the sandbox has no `crypto`). Inputs are UTF-8 text or bytes. */
export type CredentialCrypto = {
  /** `sha256`, `sha384`, `sha512`, `sha1` or `md5` of `data`. */
  hash(
    algorithm: CredentialHashAlgorithm,
    data: Uint8Array | string,
  ): Promise<Uint8Array>;
  /** HMAC of `data` under `key`. */
  hmac(
    algorithm: CredentialHashAlgorithm,
    key: Uint8Array | string,
    data: Uint8Array | string,
  ): Promise<Uint8Array>;
  /** `length` random bytes (1 to 1024). */
  randomBytes(length: number): Promise<Uint8Array>;
  /**
   * An asymmetric signature for JWT assertions: `RS256`/`RS384`/`RS512` (RSASSA-PKCS1-v1_5),
   * `PS256` (RSASSA-PSS), `ES256`/`ES384`/`ES512` (ECDSA, raw `r || s` as JWS wants it) or
   * `EdDSA` (Ed25519). `privateKey` is a PEM (PKCS#8, or PKCS#1 for RSA).
   */
  sign(input: {
    algorithm: CredentialSignAlgorithm;
    privateKey: string;
    data: Uint8Array | string;
  }): Promise<Uint8Array>;
};

/** A hash the host computes: `sha256`, `sha384`, `sha512`, `sha1` or `md5`. */
export type CredentialHashAlgorithm =
  | "sha256"
  | "sha384"
  | "sha512"
  | "sha1"
  | "md5";

/** A signature algorithm for JWT assertions (JWS names): RSA, RSA-PSS, ECDSA and Ed25519. */
export type CredentialSignAlgorithm =
  | "RS256"
  | "RS384"
  | "RS512"
  | "PS256"
  | "ES256"
  | "ES384"
  | "ES512"
  | "EdDSA";

/** What `ctx.http` of a provider may send: only to the kind's `signInOrigins`. */
export type CredentialHttpRequest = {
  /** Absolute http(s) URL; its origin must be one of the kind's `signInOrigins`. */
  url: string;
  /** Default `GET`. */
  method?: string;
  /** Request headers; framing headers (`host`, `content-length`, ...) are refused. */
  headers?: Record<string, string>;
  /** A string, a JSON value (`{ json }`) or a form (`{ form }`, `application/x-www-form-urlencoded`). */
  body?:
    | string
    | {
        /** Sent as JSON. */
        json: unknown;
      }
    | {
        /** Sent as `application/x-www-form-urlencoded`. */
        form: Record<string, string>;
      };
};

/** The response to the provider only; the backend never sees it. */
export type CredentialHttpResponse = {
  /** HTTP status; redirects are not followed. */
  status: number;
  /** Whether the status is 2xx. */
  ok: boolean;
  /** Response headers, lower-cased. */
  headers: Record<string, string>;
  /** Parsed JSON for a JSON response, else the text. */
  body: unknown;
};

/** Network access of a provider during `signIn`, `refresh` and `revoke`, limited to the kind's sign-in origins. */
export type CredentialHttp = {
  /** Sends the request. Rejects with an `ExtensionError`: `DENIED` outside the sign-in origins, `SERVER_ERROR` when the host cannot be reached. Responses over 1 MiB are refused; the time limit is 30 seconds. */
  request(request: CredentialHttpRequest): Promise<CredentialHttpResponse>;
};

/** One option of `ctx.ui.choose`. */
export type CredentialChoice = {
  /** What `choose` resolves to. */
  id: string;
  /** What the user reads. */
  label: string;
  /** A second line under the label. */
  description?: string;
};

/** Options of `CredentialUi.loopback`. */
export type CredentialLoopbackOptions = {
  /**
   * Path of the redirect URI, for services that accept only certain paths (AWS IAM Identity
   * Center: `/oauth/callback`). Default `/callback`. Segments of letters, digits and `._~-`
   * between single slashes; no `.` or `..` segments, query or fragment; at most 200 characters.
   */
  path?: string;
};

/** A loopback listener for one authorization redirect. */
export type CredentialLoopback = {
  /** The `redirect_uri` to send with the authorization request (`http://127.0.0.1:<port><path>`). */
  redirectUri: string;
  /** A random `state` the host made: send it with the authorization request; redirects without it are refused. */
  state: string;
  /** Resolves with the authorization `code` of the redirect; rejects when the user refuses, the sign-in is cancelled or times out. */
  wait(): Promise<CredentialLoopbackResult>;
};

/** What a loopback redirect carried. */
export type CredentialLoopbackResult = {
  /** The authorization code. */
  code: string;
};

/** What `signIn` can show the user: the app's sign-in dialog. Only during `signIn`. */
export type CredentialUi = {
  /** Shows a link to open (an authorization page). */
  showLink(url: string, instructions?: string): void;
  /** Shows a device code and where to enter it. */
  showDeviceCode(input: {
    userCode: string;
    verificationUri: string;
    intervalSeconds?: number;
    expiresInSeconds?: number;
  }): void;
  /** Asks the user to choose; returns the chosen id. */
  choose(message: string, options: CredentialChoice[]): Promise<string>;
  /** Asks the user for text; `secret` masks the input. */
  askText(
    message: string,
    options?: { secret?: boolean; placeholder?: string },
  ): Promise<string>;
  /** Shows progress. */
  progress(message: string): void;
  /**
   * Listens on a loopback address for one authorization redirect. Put `redirectUri` and `state`
   * in your authorization URL, show it with `showLink`, then `wait()` for the authorization `code`.
   */
  loopback(options?: CredentialLoopbackOptions): Promise<CredentialLoopback>;
};

/** The credential a provider obtained, in `signIn` and `refresh`. */
export type CredentialResult = {
  /** Opaque JSON the host keeps encrypted and hands back as `ctx.state`: tokens, session ids, role credentials. */
  state: unknown;
  /** When `state` stops working (ISO time or epoch milliseconds); absent: it does not expire. The host calls `refresh` before. */
  expiresAt?: string | number;
  /** Non-secret facts about the account (login, account id, role): short plain strings. The backend sees them in `AccountInfo.identity`. */
  identity?: Record<string, string>;
  /** The scopes the credential carries. */
  grantedScopes?: string[];
};

/** `refresh` answers with a new credential, or that the user has to sign in again. A thrown error means "could not tell" (network, 5xx): the host keeps the credential and tries later. */
export type CredentialRefreshResult = CredentialResult | CredentialNeedsSignIn;

/** The service refused the refresh for good (a revoked or expired grant): the user has to sign in again. */
export type CredentialNeedsSignIn = {
  /** Always `true`. */
  needsSignIn: true;
  /** Why, in a short sentence the user reads in Settings. */
  message?: string;
};

/** What every operation's `ctx` has. */
export type CredentialContextBase = {
  /** The account the operation runs for. */
  account: CredentialAccount;
  /** The typed-in secrets of the account by name (`secret` for the single one). */
  secrets: Record<string, string>;
  /** Hash, HMAC, random bytes and signatures. */
  crypto: CredentialCrypto;
};

/** `ctx` of `signIn`. */
export type CredentialSignInContext = CredentialContextBase & {
  /** Requests to the sign-in origins. */
  http: CredentialHttp;
  /** The sign-in dialog. */
  ui: CredentialUi;
  /** The state of the previous sign-in, when the user signs in again. */
  state: unknown;
  /** Cancellation (the user closed the dialog, or the time ran out). */
  signal: AbortSignal;
};

/** `ctx` of `refresh`. */
export type CredentialRefreshContext = CredentialContextBase & {
  /** Requests to the sign-in origins. */
  http: CredentialHttp;
  /** The state `signIn` or the last `refresh` returned. */
  state: unknown;
  /** Cancellation. */
  signal: AbortSignal;
};

/** The body of a request, by what the host can compute: never its stream. */
export type CredentialRequestBody = {
  /** Size in bytes; undefined when it is not known. */
  size: number | undefined;
  /** Digest of the whole body, computed by the host once per request (any size, files included). */
  digest(algorithm: CredentialHashAlgorithm): Promise<Uint8Array>;
  /** The bytes of a buffered body (up to 20 MiB); a larger, file-streamed body rejects with a clear error. */
  bytes(): Promise<Uint8Array>;
};

/** The request one hop of `ctx.http` is about to send. */
export type CredentialRequest = {
  /** Upper-case HTTP method. */
  method: string;
  /** The URL without the credential's own query parameters. */
  url: string;
  /** The URL's `host` (`example.amazonaws.com:8443`); the sandbox has no `URL`. */
  host: string;
  /** The URL's path, as it is sent (percent-encoded). */
  path: string;
  /** The URL's query parameters, decoded, in order. */
  query: [name: string, value: string][];
  /** Headers set so far (the extension's own). */
  headers: Record<string, string>;
  /** Absent for a request without a body. */
  body: CredentialRequestBody | undefined;
};

/** `ctx` of `apply`: no network. Whatever it sees can only travel to the origin the request already goes to. */
export type CredentialApplyContext = CredentialContextBase & {
  /** The state `signIn` or the last `refresh` returned. */
  state: unknown;
  /** The request about to be sent. */
  request: CredentialRequest;
};

/** `ctx` of `revoke`. */
export type CredentialRevokeContext = CredentialContextBase & {
  /** Requests to the sign-in origins. */
  http: CredentialHttp;
  /** The state `signIn` or the last `refresh` returned. */
  state: unknown;
  /** Cancellation. */
  signal: AbortSignal;
};

/** What `apply` adds to the request; it cannot change the method, URL, path or body. */
export type CredentialApplyResult = {
  /** Headers to set (`Authorization`, `X-Amz-Date`, ...). */
  headers?: Record<string, string>;
  /** Query parameters to add. */
  query?: Record<string, string>;
};

/** A credential provider: the four operations the host calls. */
export type CredentialProviderDefinition = {
  /** Called when the user signs in, or saves the account form. Return the credential. */
  signIn(ctx: CredentialSignInContext): Promise<CredentialResult>;
  /** Called before `expiresAt` and once after a 401 from a credentialed origin. Absent: the credential is not refreshed. */
  refresh?(ctx: CredentialRefreshContext): Promise<CredentialRefreshResult>;
  /** Called for every `ctx.http` hop to an allowed credential origin. */
  apply(
    ctx: CredentialApplyContext,
  ): Promise<CredentialApplyResult> | CredentialApplyResult;
  /** Called when the account is deleted (best effort). */
  revoke?(ctx: CredentialRevokeContext): Promise<void>;
};

/**
 * Defines the credential provider of an extension: `export default defineCredentialProvider({...})`
 * in `src/credentials.ts`. Account kinds that name `provider: "extension"` use it. The host runs it
 * in a separate sandbox, per operation, with the fixed `ctx` above.
 */
export function defineCredentialProvider(
  definition: CredentialProviderDefinition,
): CredentialProviderDefinition {
  if (typeof definition?.signIn !== "function")
    throw new Error("defineCredentialProvider needs a signIn function.");
  if (typeof definition.apply !== "function")
    throw new Error("defineCredentialProvider needs an apply function.");
  return definition;
}

/** The operations a definition implements, as the manifest records them. */
export function credentialOperations(
  definition: CredentialProviderDefinition,
): ("signIn" | "refresh" | "apply" | "revoke")[] {
  return (["signIn", "refresh", "apply", "revoke"] as const).filter(
    (name) => typeof definition[name] === "function",
  );
}
