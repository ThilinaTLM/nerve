import { randomUUID } from "node:crypto";
import type { AccountKind } from "@nervekit/contracts/extensions";
import {
  accountSecretId,
  assertUniqueAccountKinds,
  validateAccountInput,
  type AccountView,
  type StoredAccount,
} from "@nervekit/contracts/settings";
import { ApplicationError } from "../../core/application-error.js";
import { writeHomeConfiguration } from "../../infrastructure/configuration/home-configuration.js";
import type { InitializedStorage } from "../../infrastructure/storage-bootstrap/initialize.js";
import { serializeSettingsMutation } from "../../infrastructure/storage-bootstrap/settings-mutations.js";
import type { AuthManager } from "../auth/auth-manager.js";

export type AccountRecord = {
  id: string;
  name: string;
  kind: string;
  fields: Record<string, unknown>;
};

/** Read access to the user's accounts and their secrets, as extensions' host code sees them. */
export interface AccountsReader {
  get(kind: string, id: string): Promise<AccountRecord | undefined>;
  list(kind: string): Promise<AccountRecord[]>;
  /** Host-only; never passed to extension code. */
  secret(kind: string, id: string): Promise<string | undefined>;
  hasSecret(kind: string, id: string): Promise<boolean>;
}

export type AccountsServiceDeps = {
  storage: InitializedStorage;
  /** Secrets are API-key credentials named `account:<kind>:<id>`. */
  auth: Pick<
    AuthManager,
    "setApiKey" | "getApiKey" | "getCredential" | "deleteCredential"
  >;
  /** Account kinds the registered extensions define. */
  kinds: () => readonly AccountKind[];
};

const record = (kind: string, account: StoredAccount): AccountRecord => ({
  id: account.id,
  name: account.name,
  kind,
  fields: { ...account.fields },
});

/** The accounts store (`config/accounts.json`) and the secrets behind it. */
export class AccountsService implements AccountsReader {
  constructor(private readonly deps: AccountsServiceDeps) {
    // Kinds are unique across extensions; a duplicate is a registry error.
    assertUniqueAccountKinds([
      { id: "extensions", accounts: this.deps.kinds() },
    ]);
  }

  #stored(kind: string): readonly StoredAccount[] {
    return this.deps.storage.configuration.accounts.accounts[kind] ?? [];
  }

  #kind(kind: string): AccountKind {
    const found = this.deps
      .kinds()
      .find((candidate) => candidate.kind === kind);
    if (!found)
      throw new ApplicationError(
        404,
        "ACCOUNT_KIND_NOT_FOUND",
        `No extension defines the account kind '${kind}'.`,
      );
    return found;
  }

  async get(kind: string, id: string): Promise<AccountRecord | undefined> {
    const account = this.#stored(kind).find((item) => item.id === id);
    return account ? record(kind, account) : undefined;
  }

  async list(kind: string): Promise<AccountRecord[]> {
    return this.#stored(kind).map((account) => record(kind, account));
  }

  async secret(kind: string, id: string): Promise<string | undefined> {
    const credential = await this.deps.auth
      .getCredential(accountSecretId(kind, id))
      .catch(() => undefined);
    return credential?.type === "api_key" && credential.key
      ? credential.key
      : undefined;
  }

  async hasSecret(kind: string, id: string): Promise<boolean> {
    return (await this.secret(kind, id)) !== undefined;
  }

  /** The kinds the registered extensions define. */
  kinds(): readonly AccountKind[] {
    return this.deps.kinds();
  }

  /** Every account of every defined kind, for the app. */
  async views(): Promise<AccountView[]> {
    return Promise.all(
      this.deps
        .kinds()
        .flatMap((kind) =>
          this.#stored(kind.kind).map((account) =>
            this.#view(kind.kind, account),
          ),
        ),
    );
  }

  async view(kind: string, id: string): Promise<AccountView | undefined> {
    const account = this.#stored(kind).find((item) => item.id === id);
    return account ? this.#view(kind, account) : undefined;
  }

  async #view(kind: string, account: StoredAccount): Promise<AccountView> {
    return {
      kind,
      id: account.id,
      name: account.name,
      fields: { ...account.fields },
      secretConfigured: await this.hasSecret(kind, account.id),
    };
  }

  /** Creates the account (no `id`) or replaces an existing one. */
  async save(input: {
    kind: string;
    id?: string;
    name: string;
    fields: Record<string, unknown>;
  }): Promise<AccountRecord> {
    const definition = this.#kind(input.kind);
    const checked = validateAccountInput(definition, input);
    if (!checked.ok)
      throw new ApplicationError(400, "ACCOUNT_INVALID", checked.message);
    return serializeSettingsMutation(this.deps.storage, async () => {
      const current = this.#stored(input.kind);
      if (input.id && !current.some((item) => item.id === input.id))
        throw new ApplicationError(
          404,
          "ACCOUNT_NOT_FOUND",
          `Account '${input.id}' does not exist.`,
        );
      const saved: StoredAccount = {
        id: input.id ?? randomUUID(),
        name: checked.name,
        fields: checked.fields,
      };
      await this.#write(
        input.kind,
        input.id
          ? current.map((item) => (item.id === saved.id ? saved : item))
          : [...current, saved],
      );
      return record(input.kind, saved);
    });
  }

  async setSecret(kind: string, id: string, secret: string): Promise<void> {
    this.#kind(kind);
    if (!(await this.get(kind, id)))
      throw new ApplicationError(
        404,
        "ACCOUNT_NOT_FOUND",
        `Account '${id}' does not exist.`,
      );
    await this.deps.auth.setApiKey(accountSecretId(kind, id), secret);
  }

  /** Removes the account and its secret; false when it did not exist. */
  async delete(kind: string, id: string): Promise<boolean> {
    this.#kind(kind);
    const removed = await serializeSettingsMutation(
      this.deps.storage,
      async () => {
        const current = this.#stored(kind);
        if (!current.some((item) => item.id === id)) return false;
        await this.#write(
          kind,
          current.filter((item) => item.id !== id),
        );
        return true;
      },
    );
    if (removed)
      await this.deps.auth.deleteCredential(accountSecretId(kind, id));
    return removed;
  }

  async #write(kind: string, accounts: StoredAccount[]): Promise<void> {
    const { storage } = this.deps;
    const next = {
      ...storage.configuration.accounts.accounts,
      [kind]: accounts,
    };
    storage.configuration = await writeHomeConfiguration(
      storage.paths,
      {
        ...storage.configuration,
        accounts: { version: 2, accounts: next },
      },
      ["accounts"],
    );
  }
}
