import type { AccountState } from "@nervekit/contracts/settings";
import type { AccountKind } from "@nervekit/contracts/extensions";
import type {
  AccountRepository,
  AccountRow,
  AccountStatus,
} from "@nervekit/conversation-core";
import {
  openCredential,
  sealCredential,
  type CredentialBlob,
} from "./credential-blob.js";
import {
  CredentialUnusableError,
  staticProvider,
  type AppliedCredential,
  type ApplyRequest,
  type CredentialProvider,
  type ProviderAccount,
  type ProviderOutcome,
} from "./credential-provider.js";

/** `last_used_at` is written at most this often per account. */
const TOUCH_INTERVAL_MS = 60_000;

export type CredentialVaultDeps = {
  repository: () => AccountRepository;
  /** The master key (`secrets/master.key`). */
  key: () => Promise<Buffer>;
  /** The definition an account uses; undefined when its extension is gone or off. */
  definition: (row: AccountRow) => AccountKind | undefined;
  /** The provider of a kind; the `static` provider unless the kind names another. */
  provider?: (kind: AccountKind) => CredentialProvider;
  now?: () => Date;
};

/** What an account can do right now, with the provider's message when it failed. */
export type VaultState = { state: AccountState; error?: string };

export type ApplyOutcome =
  | ({ ok: true } & AppliedCredential)
  | { ok: false; state: Exclude<AccountState, "ready">; error?: string };

/**
 * The only reader and writer of the `account.credential` column and the only caller of provider
 * operations. The credential is one AES-256-GCM blob under the master key with the account id as
 * associated data; `status`, `expires_at` and `last_used_at` stay readable without decrypting it.
 * Secrets go to a provider and come back only as headers or query parameters for one hop.
 */
export class CredentialVault {
  readonly #locks = new Map<string, Promise<unknown>>();
  readonly #touched = new Map<string, number>();

  constructor(private readonly deps: CredentialVaultDeps) {}

  #now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  #provider(kind: AccountKind): CredentialProvider {
    return this.deps.provider?.(kind) ?? staticProvider;
  }

  #row(id: string): AccountRow {
    const row = this.deps.repository().get(id);
    if (!row) throw new Error(`Account not found: ${id}`);
    return row;
  }

  /**
   * One operation per account at a time, in call order: writes, and later refreshes. Others wait
   * for it. One daemon runs per home, so an in-process lock is enough.
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

  /** Stored status, with `unavailable` derived when the kind's definition is gone or off. */
  async state(accountId: string): Promise<VaultState> {
    const row = this.deps.repository().get(accountId);
    return row ? await this.stateOf(row) : { state: "needs_sign_in" };
  }

  async stateOf(row: AccountRow): Promise<VaultState> {
    if (!this.deps.definition(row)) return { state: "unavailable" };
    if (row.status === "failed") {
      let error: string | undefined;
      try {
        error = (await this.#open(row))?.error;
      } catch {
        error = "The stored credential could not be read.";
      }
      return { state: "failed", ...(error ? { error } : {}) };
    }
    return { state: row.status === "ready" ? "ready" : "needs_sign_in" };
  }

  /**
   * Saves typed-in secrets (names left out keep their stored value) and lets the provider sign
   * in with them. The stored status follows the provider's answer.
   */
  async saveSecrets(
    account: ProviderAccount,
    secrets: Record<string, string>,
  ): Promise<void> {
    await this.withLock(account.id, async () => {
      const row = this.#row(account.id);
      const current = (await this.#open(row))?.secrets ?? {};
      const merged = { ...current, ...secrets };
      await this.#store(row.id, merged, await this.#signIn(account, merged));
    });
  }

  async #signIn(
    account: ProviderAccount,
    secrets: Record<string, string>,
  ): Promise<ProviderOutcome | { status: "failed"; message: string }> {
    try {
      return await this.#provider(account.kind).signIn(account, { secrets });
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
    outcome: ProviderOutcome | { status: "failed"; message: string },
  ): Promise<void> {
    const blob: CredentialBlob = { v: 1, secrets };
    const status: AccountStatus = outcome.status;
    let expiresAt: string | null = null;
    if (outcome.status === "ready") {
      if (outcome.state !== undefined) blob.state = outcome.state;
      if (outcome.identity) blob.identity = outcome.identity;
      if (outcome.grantedScopes) blob.grantedScopes = outcome.grantedScopes;
      expiresAt = outcome.expiresAt ?? null;
    } else if (outcome.message) blob.error = outcome.message;
    const empty = Object.keys(secrets).length === 0 && !blob.error;
    this.deps.repository().writeCredential(id, {
      credential: empty ? null : await this.#seal(id, blob),
      status,
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
  }

  /**
   * The headers and query parameters for one hop to an allowed credential origin. The caller has
   * checked the origin; the provider cannot change the request, only add to it.
   */
  async apply(
    account: ProviderAccount,
    request: ApplyRequest,
  ): Promise<ApplyOutcome> {
    const row = this.deps.repository().get(account.id);
    if (!row) return { ok: false, state: "needs_sign_in" };
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

  /** Marks the account used (credentialed request or test), at most once a minute. */
  touch(accountId: string): void {
    const now = this.#now().getTime();
    const last = this.#touched.get(accountId);
    if (last !== undefined && now - last < TOUCH_INTERVAL_MS) return;
    this.#touched.set(accountId, now);
    this.deps.repository().touch(accountId, new Date(now).toISOString());
  }
}
