import {
  accountInjections,
  accountSecretFields,
  type AccountKind,
} from "@nervekit/contracts/extensions";
import type { ExtensionCredentialCode } from "./extension-credential-provider.js";
import type { SignInInteraction } from "../auth/sign-in-service.js";
import type { CredentialBlob } from "./credential-blob.js";

/** The account a provider works for: what the host knows besides the credential. */
export type ProviderAccount = {
  id: string;
  kind: AccountKind;
  fields: Record<string, unknown>;
  /** The credential code of the extension that defines the kind (`provider: "extension"`). */
  credentials?: ExtensionCredentialCode;
};

/** What the provider sees of the stored credential. */
export type ProviderCredential = Pick<
  CredentialBlob,
  "secrets" | "state" | "identity" | "grantedScopes"
>;

/** The result of `signIn` and `refresh`; the vault stores it. */
export type ProviderOutcome =
  | {
      status: "ready";
      state?: unknown;
      identity?: Record<string, string>;
      grantedScopes?: string[];
      /** ISO time the access token expires; absent: it does not. */
      expiresAt?: string;
      /** Hash of the credential code that produced this credential (extension providers). */
      codeHash?: string;
    }
  | {
      /** Nothing usable: the user has to sign in or enter the secrets. */
      status: "needs_sign_in";
      message?: string;
    }
  | {
      /** The service refused the account's client or credential for a reason the user must fix. */
      status: "failed";
      message: string;
    };

/** One hop of a request to an origin the account's credential may go to. */
export type ApplyRequest = {
  method: string;
  url: URL;
  /** Headers of the request so far; the credential's own are not among them. */
  headers?: Record<string, string>;
  /** The body as digests and (for buffered bodies) bytes; absent without a body. */
  body?: {
    size: number | undefined;
    digest(algorithm: string): Promise<Uint8Array>;
    bytes(): Promise<Uint8Array>;
  };
};

/** What `apply` adds to the hop; it cannot change the method, URL or body. */
export type AppliedCredential = {
  headers: Record<string, string>;
  query: Record<string, string>;
};

/** The service could not be reached or failed (network, 5xx): nothing about the credential is known, keep it. */
export class CredentialTransientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialTransientError";
  }
}

/** `apply` found the credential unusable (not a host failure). */
export class CredentialUnusableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialUnusableError";
  }
}

/**
 * How an account kind's credential is obtained, kept fresh and applied to requests. Host-internal:
 * the built-in providers (`static`, later `oauth2`) and extension providers implement it; the vault
 * is its only caller, and none of it is reachable from the backend, UI or agent.
 */
export interface CredentialProvider {
  /**
   * Typed-in secrets saved, or the user signed in. `interaction` is present only for a sign-in the
   * user started; without it a provider that needs one answers `needs_sign_in`.
   */
  signIn(
    account: ProviderAccount,
    input: { secrets: Record<string, string>; interaction?: SignInInteraction },
  ): Promise<ProviderOutcome>;
  /** The provider obtains its credential by an interactive sign-in, so saving secrets does not replace it. */
  readonly interactive?: boolean;
  /**
   * Before expiry or after a 401. Returns the complete new state; throws `CredentialTransientError`
   * when the service could not be reached.
   */
  refresh(
    account: ProviderAccount,
    credential: ProviderCredential,
    signal?: AbortSignal,
  ): Promise<ProviderOutcome>;
  /** Whether `refresh` can obtain a new credential (a refresh token exists). Absent: never. */
  canRefresh?(
    credential: ProviderCredential,
    account: ProviderAccount,
  ): boolean;
  /**
   * The hash of the credential code that would handle this account now. A credential written by
   * other code (`CredentialBlob.codeHash`) is not handed to the provider: consent covers the code
   * it was shown, so the account needs sign-in again.
   */
  codeHash?(account: ProviderAccount): string | undefined;
  /** Scopes the account's kind needs; an account whose granted scopes are fewer needs sign-in. */
  requiredScopes?(account: ProviderAccount): readonly string[];
  /** Headers and query parameters for one hop to an allowed credential origin. */
  apply(
    account: ProviderAccount,
    credential: ProviderCredential,
    request: ApplyRequest,
  ): Promise<AppliedCredential>;
  /** The account is deleted; best effort. */
  revoke(
    account: ProviderAccount,
    credential: ProviderCredential,
  ): Promise<void>;
}

const HEADER_VALUE = /[\r\n\0]/;

/** Typed-in secrets injected as a header, a basic-auth password, a bearer token or a query parameter. */
export const staticProvider: CredentialProvider = {
  async signIn(account, { secrets }) {
    for (const [name, field] of Object.entries(
      accountSecretFields(account.kind),
    ))
      if (!secrets[name])
        return {
          status: "needs_sign_in",
          message: `Enter the ${field.label}.`,
        };
    return { status: "ready" };
  },
  async refresh(account, credential) {
    // Typed-in secrets do not expire: nothing to refresh.
    return Object.keys(accountSecretFields(account.kind)).every(
      (name) => credential.secrets[name],
    )
      ? { status: "ready" }
      : { status: "needs_sign_in" };
  },
  async apply(account, credential) {
    const applied: AppliedCredential = { headers: {}, query: {} };
    for (const auth of accountInjections(account.kind)) {
      const secret = credential.secrets[auth.secret];
      if (!secret) throw new CredentialUnusableError("A secret is missing.");
      if (auth.scheme !== "query" && HEADER_VALUE.test(secret))
        throw new CredentialUnusableError("A secret is not valid in a header.");
      switch (auth.scheme) {
        case "bearer":
          applied.headers.authorization = `Bearer ${secret}`;
          break;
        case "header":
          applied.headers[auth.name.toLowerCase()] = secret;
          break;
        case "basic": {
          const user = account.fields[auth.user];
          applied.headers.authorization = `Basic ${Buffer.from(`${typeof user === "string" ? user : ""}:${secret}`, "utf8").toString("base64")}`;
          break;
        }
        case "query":
          applied.query[auth.name] = secret;
          break;
      }
    }
    return applied;
  },
  async revoke() {},
};
