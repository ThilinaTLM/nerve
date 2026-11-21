import {
  accountInjections,
  accountSecretFields,
  type AccountKind,
} from "@nervekit/contracts/extensions";
import type { CredentialBlob } from "./credential-blob.js";

/** The account a provider works for: what the host knows besides the credential. */
export type ProviderAccount = {
  id: string;
  kind: AccountKind;
  fields: Record<string, unknown>;
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
    }
  | {
      /** Nothing usable: the user has to sign in or enter the secrets. */
      status: "needs_sign_in";
      message?: string;
    };

/** One hop of a request to an origin the account's credential may go to. */
export type ApplyRequest = { method: string; url: URL };

/** What `apply` adds to the hop; it cannot change the method, URL or body. */
export type AppliedCredential = {
  headers: Record<string, string>;
  query: Record<string, string>;
};

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
  /** Typed-in secrets saved, or the user signed in. */
  signIn(
    account: ProviderAccount,
    input: { secrets: Record<string, string> },
  ): Promise<ProviderOutcome>;
  /** Before expiry or after a 401. */
  refresh(
    account: ProviderAccount,
    credential: ProviderCredential,
  ): Promise<ProviderOutcome>;
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
