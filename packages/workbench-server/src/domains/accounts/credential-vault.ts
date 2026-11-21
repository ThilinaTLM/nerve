import type { AccountState } from "@nervekit/contracts/settings";
import type { AccountKind } from "@nervekit/contracts/extensions";
import type {
  AccountRepository,
  AccountRow,
  AccountStatus,
} from "@nervekit/conversation-core";
import type { SignInInteraction } from "../auth/sign-in-service.js";
import {
  openCredential,
  sealCredential,
  type CredentialBlob,
} from "./credential-blob.js";
import {
  createExtensionCredentialProvider,
  type ExtensionCredentialCode,
  type ExtensionCredentialProviderDeps,
} from "./extension-credential-provider.js";
import {
  CredentialTransientError,
  CredentialUnusableError,
  staticProvider,
  type AppliedCredential,
  type ApplyRequest,
  type CredentialProvider,
  type ProviderAccount,
  type ProviderOutcome,
} from "./credential-provider.js";
import {
  createOAuth2Provider,
  type OAuth2ProviderDeps,
} from "./oauth2-provider.js";

/** `last_used_at` is written at most this often per account. */
const TOUCH_INTERVAL_MS = 60_000;
/** A request refreshes the access token when it expires within this long. */
const REFRESH_AHEAD_MS = 60_000;
/** The background sweep refreshes tokens that expire within this long ... */
const SWEEP_EXPIRES_WITHIN_MS = 10 * 60_000;
/** ... of accounts used within this long. */
const SWEEP_USED_WITHIN_MS = 30 * 24 * 60 * 60_000;

export type CredentialVaultDeps = {
  repository: () => AccountRepository;
  /** The master key (`secrets/master.key`). */
  key: () => Promise<Buffer>;
  /** The definition an account uses; undefined when its extension is gone or off. */
  definition: (row: AccountRow) => AccountKind | undefined;
  /** The credential code of the extension that defines the account's kind, for `provider: "extension"`. */
  credentialCode?: (row: AccountRow) => ExtensionCredentialCode | undefined;
  /** Replaces the provider of a kind (tests). */
  provider?: (kind: AccountKind) => CredentialProvider | undefined;
  /** Settings of the built-in `oauth2` provider (its guarded fetch). */
  oauth2?: OAuth2ProviderDeps;
  /** Settings of the provider that runs extensions' credential code (its guarded fetch). */
  extension?: Omit<ExtensionCredentialProviderDeps, "code">;
  now?: () => Date;
};

/** What an account can do right now, with the provider's message when it failed. */
export type VaultState = { state: AccountState; error?: string };

export type ApplyOutcome =
  | ({ ok: true } & AppliedCredential)
  | {
      ok: false;
      /** `unreachable`: refreshing failed for network reasons; the credential is unchanged. */
      state: Exclude<AccountState, "ready"> | "unreachable";
      error?: string;
    };

/** An account the refresh sweep could not keep ready. */
export type RefreshProblem = {
  id: string;
  kind: string;
  name: string;
  state: "needs_sign_in" | "failed";
  error?: string;
};

export type RefreshSweep = {
  /** Accounts the query found. */
  checked: number;
  refreshed: number;
  /** Found, but with nothing to refresh with (no refresh token). */
  skipped: number;
  /** Refresh failed for network reasons; tried again at the next sweep. */
  unreachable: number;
  problems: RefreshProblem[];
};

type RefreshResult =
  | { ok: true }
  | {
      ok: false;
      state: "needs_sign_in" | "failed" | "unreachable";
      error?: string;
    };

/**
 * The only reader and writer of the `account.credential` column and the only caller of provider
 * operations. The credential is one AES-256-GCM blob under the master key with the account id as
 * associated data; `status`, `expires_at` and `last_used_at` stay readable without decrypting it.
 * Secrets go to a provider and come back only as headers or query parameters for one hop.
 */
export class CredentialVault {
  readonly #locks = new Map<string, Promise<unknown>>();
  readonly #touched = new Map<string, number>();
  /** When each account's credential was last refreshed, to let a 401 retry reuse a newer token. */
  readonly #refreshedAt = new Map<string, number>();
  readonly #oauth2: CredentialProvider;
  readonly #extension: CredentialProvider;

  constructor(private readonly deps: CredentialVaultDeps) {
    this.#oauth2 = createOAuth2Provider(deps.oauth2);
    this.#extension = createExtensionCredentialProvider(deps.extension ?? {});
  }

  #now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  #provider(kind: AccountKind): CredentialProvider {
    const given = this.deps.provider?.(kind);
    if (given) return given;
    if (kind.provider === "extension") return this.#extension;
    return typeof kind.provider === "object" && kind.provider.type === "oauth2"
      ? this.#oauth2
      : staticProvider;
  }

  #row(id: string): AccountRow {
    const row = this.deps.repository().get(id);
    if (!row) throw new Error(`Account not found: ${id}`);
    return row;
  }

  /**
   * One operation per account at a time, in call order: writes and refreshes. Others wait for it.
   * One daemon runs per home, so an in-process lock is enough.
   */
  async withLock<T>(
    accountId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.#locks.get(accountId) ?? Promise.resolve();
    const run = previous.then(operation, operation);
    const settled = run.catch(() => undefined);
    this.#locks.set(accountId, settled);
    try {
      return await run;
    } finally {
      if (this.#locks.get(accountId) === settled) this.#locks.delete(accountId);
    }
  }

  async #open(row: AccountRow): Promise<CredentialBlob | undefined> {
    const sealed = this.deps.repository().readCredential(row.id);
    return sealed
      ? openCredential(await this.deps.key(), row.id, sealed)
      : undefined;
  }

  async #seal(id: string, blob: CredentialBlob): Promise<Uint8Array> {
    return sealCredential(await this.deps.key(), id, blob);
  }

  /**
   * Whether the code consent covers now wrote the credential. Typed-in secrets (no code) are
   * always covered; a credential written by other code is not handed to the provider.
   */
  #covered(
    provider: CredentialProvider,
    account: ProviderAccount,
    blob: CredentialBlob,
  ): boolean {
    const current = provider.codeHash?.(account);
    return current === undefined || blob.codeHash === current;
  }

  #account(row: AccountRow, kind: AccountKind): ProviderAccount {
    const credentials = this.deps.credentialCode?.(row);
    return {
      id: row.id,
      kind,
      fields: row.fields,
      ...(credentials ? { credentials } : {}),
    };
  }

  /** What the provider reported about the account at sign-in; for the backend's `AccountInfo`. */
  async identityOf(
    row: AccountRow,
  ): Promise<Record<string, string> | undefined> {
    if (row.status !== "ready" || !row.hasCredential) return undefined;
    const kind = this.deps.definition(row);
    // Typed-in secrets report nothing; only a provider's accounts have an identity to read.
    if (!kind?.provider) return undefined;
    try {
      return (await this.#open(row))?.identity;
    } catch {
      return undefined;
    }
  }

  /** Stored status, with `unavailable` and the credential-derived `needs_sign_in` applied. */
  async state(accountId: string): Promise<VaultState> {
    const row = this.deps.repository().get(accountId);
    return row ? await this.stateOf(row) : { state: "needs_sign_in" };
  }

  async stateOf(row: AccountRow): Promise<VaultState> {
    const kind = this.deps.definition(row);
    if (!kind) return { state: "unavailable" };
    if (row.status === "needs_sign_in") return { state: "needs_sign_in" };
    const provider = this.#provider(kind);
    const account = this.#account(row, kind);
    const required = provider.requiredScopes?.(account) ?? [];
    const expired =
      row.expiresAt !== null &&
      Date.parse(row.expiresAt) <= this.#now().getTime();
    // Only what the row cannot say needs the credential: the error of a failed account, scopes,
    // and whether an expired access token can still be refreshed. Availability never refreshes.
    const bound = provider.codeHash !== undefined;
    if (row.status === "ready" && required.length === 0 && !expired && !bound)
      return { state: "ready" };
    let blob: CredentialBlob | undefined;
    try {
      blob = await this.#open(row);
    } catch {
      return {
        state: "failed",
        error: "The stored credential could not be read.",
      };
    }
    if (row.status === "failed")
      return { state: "failed", ...(blob?.error ? { error: blob.error } : {}) };
    if (!blob) return { state: "needs_sign_in" };
    if (!this.#covered(provider, account, blob))
      return {
        state: "needs_sign_in",
        error: "The extension's credential code changed. Sign in again.",
      };
    if (expired && !provider.canRefresh?.(blob, account))
      return { state: "needs_sign_in", error: "The sign-in expired." };
    const granted = new Set(blob.grantedScopes ?? []);
    const missing = required.filter((scope) => !granted.has(scope));
    if (missing.length > 0)
      return {
        state: "needs_sign_in",
        error: `The account needs to be signed in again for more permissions: ${missing.join(", ")}.`,
      };
    return { state: "ready" };
  }

  /**
   * Saves typed-in secrets (names left out keep their value). A provider that signs in
   * interactively keeps its tokens and only learns the secrets; the others sign in with them.
   */
  async saveSecrets(
    account: ProviderAccount,
    secrets: Record<string, string>,
  ): Promise<void> {
    await this.withLock(account.id, async () => {
      const row = this.#row(account.id);
      const blob = await this.#open(row);
      const merged = { ...blob?.secrets, ...secrets };
      const provider = this.#provider(account.kind);
      if (provider.interactive) {
        const next: CredentialBlob = { v: 1, ...blob, secrets: merged };
        this.deps.repository().writeCredential(row.id, {
          credential: await this.#seal(row.id, next),
          status: row.status,
          expiresAt: row.expiresAt,
          updatedAt: this.#now().toISOString(),
        });
        return;
      }
      await this.#store(
        row.id,
        merged,
        await this.#signIn(provider, account, merged),
      );
    });
  }

  /**
   * Signs in with the user present (`interaction`) and stores the result. The lock is taken only
   * for the write: requests keep using the old credential while the user signs in.
   */
  async signIn(
    account: ProviderAccount,
    interaction: SignInInteraction,
  ): Promise<ProviderOutcome> {
    const row = this.#row(account.id);
    const secrets = (await this.#open(row))?.secrets ?? {};
    const provider = this.#provider(account.kind);
    const outcome = await provider.signIn(account, { secrets, interaction });
    // A sign-in that ends without credentials (declined, expired) leaves a working account alone.
    if (outcome.status !== "ready") return outcome;
    await this.withLock(account.id, async () => {
      this.#row(account.id);
      await this.#store(account.id, secrets, outcome);
    });
    this.#refreshedAt.set(account.id, this.#now().getTime());
    return outcome;
  }

  async #signIn(
    provider: CredentialProvider,
    account: ProviderAccount,
    secrets: Record<string, string>,
  ): Promise<ProviderOutcome> {
    try {
      return await provider.signIn(account, { secrets });
    } catch (error) {
      return {
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async #store(
    id: string,
    secrets: Record<string, string>,
    outcome: ProviderOutcome,
  ): Promise<void> {
    const blob: CredentialBlob = { v: 1, secrets };
    let expiresAt: string | null = null;
    if (outcome.status === "ready") {
      if (outcome.state !== undefined) blob.state = outcome.state;
      if (outcome.identity) blob.identity = outcome.identity;
      if (outcome.grantedScopes) blob.grantedScopes = outcome.grantedScopes;
      if (outcome.codeHash) blob.codeHash = outcome.codeHash;
      expiresAt = outcome.expiresAt ?? null;
    } else if (outcome.message) blob.error = outcome.message;
    const empty = Object.keys(secrets).length === 0 && !blob.error;
    this.deps.repository().writeCredential(id, {
      credential: empty ? null : await this.#seal(id, blob),
      status: outcome.status,
      expiresAt,
      updatedAt: this.#now().toISOString(),
    });
  }

  /** Forgets the credential: nothing stored, the account needs sign-in. */
  async clear(accountId: string): Promise<void> {
    await this.withLock(accountId, async () => {
      this.deps.repository().writeCredential(accountId, {
        credential: null,
        status: "needs_sign_in",
        expiresAt: null,
        updatedAt: this.#now().toISOString(),
      });
    });
  }

  /**
   * The credential of `fromId` sealed for the new account `toId`, with its status and expiry, for
   * the insert of a duplicate. Null when nothing is stored.
   */
  async reseal(
    fromId: string,
    toId: string,
  ): Promise<{
    credential: Uint8Array;
    status: AccountStatus;
    expiresAt: string | null;
  } | null> {
    return await this.withLock(fromId, async () => {
      const row = this.#row(fromId);
      const blob = await this.#open(row);
      if (!blob) return null;
      return {
        credential: await this.#seal(toId, blob),
        status: row.status,
        expiresAt: row.expiresAt,
      };
    });
  }

  /** Revokes with the provider (best effort); the caller deletes the row. */
  async revoke(account: ProviderAccount): Promise<void> {
    try {
      const row = this.deps.repository().get(account.id);
      const blob = row ? await this.#open(row) : undefined;
      if (blob) await this.#provider(account.kind).revoke(account, blob);
    } catch {
      // Revocation is best effort.
    }
    this.#touched.delete(account.id);
    this.#refreshedAt.delete(account.id);
  }

  /**
   * Refreshes the credential of one account. The caller holds the account's lock; the new
   * credential, status and expiry are written in one statement before anything uses the token.
   */
  async #refreshLocked(
    account: ProviderAccount,
    row: AccountRow,
    blob: CredentialBlob,
    signal?: AbortSignal,
  ): Promise<RefreshResult> {
    const provider = this.#provider(account.kind);
    let outcome: ProviderOutcome;
    try {
      outcome = await provider.refresh(account, blob, signal);
    } catch (error) {
      // Not knowing is not a verdict: the stored credential stays as it is.
      return {
        ok: false,
        state: "unreachable",
        error:
          error instanceof CredentialTransientError
            ? error.message
            : "The credential could not be refreshed.",
      };
    }
    const kept: CredentialBlob = { ...blob };
    delete kept.state;
    const update = async (
      next: CredentialBlob,
      status: AccountStatus,
      expiresAt: string | null,
    ) =>
      this.deps.repository().writeCredential(row.id, {
        credential: await this.#seal(row.id, next),
        status,
        expiresAt,
        updatedAt: this.#now().toISOString(),
      });
    if (outcome.status === "ready") {
      const next: CredentialBlob = { ...blob, state: outcome.state };
      delete next.error;
      if (outcome.identity) next.identity = outcome.identity;
      if (outcome.grantedScopes) next.grantedScopes = outcome.grantedScopes;
      if (outcome.codeHash) next.codeHash = outcome.codeHash;
      const granted = new Set(next.grantedScopes ?? []);
      const missing = (provider.requiredScopes?.(account) ?? []).some(
        (scope) => !granted.has(scope),
      );
      if (missing) {
        const message =
          "The service granted fewer permissions than needed. Sign in again.";
        await update({ ...kept, error: message }, "needs_sign_in", null);
        return { ok: false, state: "needs_sign_in", error: message };
      }
      await update(next, "ready", outcome.expiresAt ?? null);
      this.#refreshedAt.set(row.id, this.#now().getTime());
      return { ok: true };
    }
    const status = outcome.status;
    const message =
      outcome.message ??
      (status === "failed"
        ? "The credential does not work."
        : "Sign in again.");
    await update({ ...kept, error: message }, status, null);
    return { ok: false, state: status, error: message };
  }

  /** Under the account's lock, refreshes unless another caller just did. */
  async #refreshIfDue(
    account: ProviderAccount,
    aheadMs: number,
    signal?: AbortSignal,
  ): Promise<RefreshResult | "skipped"> {
    return await this.withLock(account.id, async () => {
      const row = this.deps.repository().get(account.id);
      if (!row || row.status !== "ready" || row.expiresAt === null)
        return "skipped";
      if (Date.parse(row.expiresAt) - this.#now().getTime() >= aheadMs)
        return "skipped";
      const blob = await this.#open(row);
      const provider = this.#provider(account.kind);
      if (
        !blob ||
        !provider.canRefresh?.(blob, account) ||
        !this.#covered(provider, account, blob)
      )
        return "skipped";
      return await this.#refreshLocked(account, row, blob, signal);
    });
  }

  /**
   * The headers and query parameters for one hop to an allowed credential origin. An access token
   * that expires within a minute is refreshed first. The caller has checked the origin; the
   * provider cannot change the request, only add to it.
   */
  async apply(
    account: ProviderAccount,
    request: ApplyRequest,
  ): Promise<ApplyOutcome> {
    let row = this.deps.repository().get(account.id);
    if (!row) return { ok: false, state: "needs_sign_in" };
    if (
      row.expiresAt !== null &&
      Date.parse(row.expiresAt) - this.#now().getTime() < REFRESH_AHEAD_MS
    ) {
      const refreshed = await this.#refreshIfDue(account, REFRESH_AHEAD_MS);
      if (refreshed !== "skipped" && !refreshed.ok)
        return {
          ok: false,
          state: refreshed.state,
          ...(refreshed.error ? { error: refreshed.error } : {}),
        };
      row = this.deps.repository().get(account.id) ?? row;
    }
    const stored = await this.stateOf(row);
    if (stored.state !== "ready")
      return {
        ok: false,
        state: stored.state,
        ...(stored.error ? { error: stored.error } : {}),
      };
    let blob: CredentialBlob | undefined;
    try {
      blob = await this.#open(row);
    } catch {
      return {
        ok: false,
        state: "failed",
        error: "The stored credential could not be read.",
      };
    }
    if (!blob) return { ok: false, state: "needs_sign_in" };
    try {
      const applied = await this.#provider(account.kind).apply(
        account,
        blob,
        request,
      );
      this.touch(account.id);
      return { ok: true, ...applied };
    } catch (error) {
      if (error instanceof CredentialUnusableError)
        return { ok: false, state: "needs_sign_in" };
      return {
        ok: false,
        state: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * The service answered 401 to a credentialed request that began at `requestStartedAt`: gets a new
   * access token so the caller can retry once. True when the credential is newer than the request
   * (refreshed now, or by a request that was faster).
   */
  async refreshAfterRejection(
    account: ProviderAccount,
    requestStartedAt: number,
  ): Promise<boolean> {
    return await this.withLock(account.id, async () => {
      const refreshedAt = this.#refreshedAt.get(account.id);
      if (refreshedAt !== undefined && refreshedAt >= requestStartedAt)
        return true;
      const row = this.deps.repository().get(account.id);
      if (!row || row.status !== "ready") return false;
      const blob = await this.#open(row);
      const provider = this.#provider(account.kind);
      if (
        !blob ||
        !provider.canRefresh?.(blob, account) ||
        !this.#covered(provider, account, blob)
      )
        return false;
      return (await this.#refreshLocked(account, row, blob)).ok;
    });
  }

  /**
   * The background sweep: refreshes ready accounts whose access token expires within ten
   * minutes and that were used within thirty days, one by one through the same locked path.
   * It does not mark the accounts used, or nothing would ever age out.
   */
  async refreshDue(
    options: {
      signal?: AbortSignal;
      now?: Date;
    } = {},
  ): Promise<RefreshSweep> {
    const now = (options.now ?? this.#now()).getTime();
    const candidates = this.deps.repository().refreshCandidates({
      expiresBefore: new Date(now + SWEEP_EXPIRES_WITHIN_MS).toISOString(),
      usedAfter: new Date(now - SWEEP_USED_WITHIN_MS).toISOString(),
    });
    const sweep: RefreshSweep = {
      checked: candidates.length,
      refreshed: 0,
      skipped: 0,
      unreachable: 0,
      problems: [],
    };
    for (const candidate of candidates) {
      if (options.signal?.aborted) break;
      const kind = this.deps.definition(candidate);
      if (!kind) {
        sweep.skipped++;
        continue;
      }
      const result = await this.#refreshIfDue(
        this.#account(candidate, kind),
        SWEEP_EXPIRES_WITHIN_MS,
        options.signal,
      );
      if (result === "skipped") sweep.skipped++;
      else if (result.ok) sweep.refreshed++;
      else if (result.state === "unreachable") sweep.unreachable++;
      else
        sweep.problems.push({
          id: candidate.id,
          kind: candidate.kind,
          name: candidate.name,
          state: result.state,
          ...(result.error ? { error: result.error } : {}),
        });
    }
    return sweep;
  }

  /** Marks the account used (credentialed request or test), at most once a minute. */
  touch(accountId: string): void {
    const now = this.#now().getTime();
    const last = this.#touched.get(accountId);
    if (last !== undefined && now - last < TOUCH_INTERVAL_MS) return;
    this.#touched.set(accountId, now);
    this.deps.repository().touch(accountId, new Date(now).toISOString());
  }
}
