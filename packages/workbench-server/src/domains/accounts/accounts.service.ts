import { randomUUID } from "node:crypto";
import {
  accountSecretFields,
  withScopeUnion,
  type AccountKind,
} from "@nervekit/contracts/extensions";
import {
  assertUniqueAccountKinds,
  validateAccountInput,
  type AccountLevel,
  type AccountState,
  type AccountView,
} from "@nervekit/contracts/settings";
import type {
  AccountRepository,
  AccountRow,
} from "@nervekit/conversation-core";
import { ApplicationError } from "../../core/application-error.js";
import {
  allowsLevel,
  definitionOf,
  levelOf,
  visibleTo,
  type AccountDefinition,
} from "./account-levels.js";
import {
  CredentialVault,
  type ApplyOutcome,
  type CredentialVaultDeps,
} from "./credential-vault.js";
import type { PlatformUseSource } from "./platform-uses.js";
import type { SignInInteraction } from "../auth/sign-in-service.js";
import type { ApplyRequest, ProviderAccount } from "./credential-provider.js";

/** An account as extension host code sees it; the credential is never part of it. */
export type AccountRecord = {
  id: string;
  name: string;
  kind: string;
  fields: Record<string, unknown>;
  level: AccountLevel;
  /** The project of a project-level account. */
  projectId?: string;
  /** What the provider reported about the account at sign-in; short plain strings. */
  identity?: Record<string, string>;
};

/**
 * What a scope may read: its accounts and what the vault does with their credentials. Bound to
 * a project (user-level accounts and that project's) or to none (user-level only).
 */
export interface AccountsReader {
  /** `userLevelOnly`: the selection came from user scope, which can name user-level accounts only. */
  get(
    kind: string,
    id: string,
    options?: { userLevelOnly?: boolean },
  ): Promise<AccountRecord | undefined>;
  list(kind: string): Promise<AccountRecord[]>;
  /**
   * The definitions of a platform this scope may use, whichever extension defines them: built-in
   * and user ones, and the project's own. Absent in readers that only hold accounts (tests).
   */
  platformKinds?(platform: string): AccountKind[];
  state(kind: string, id: string): Promise<AccountState>;
  /** Why the account is not ready, when its state says (the scopes it lacks). */
  problem?(kind: string, id: string): Promise<string | undefined>;
  /** Host-only: headers and query parameters for one hop to an allowed credential origin. */
  apply(kind: string, id: string, request: ApplyRequest): Promise<ApplyOutcome>;
  /**
   * A credentialed request began at `requestStartedAt` and the service answered 401: gets a newer
   * access token so the request can be retried once. False when there is nothing to refresh with.
   */
  refreshAfterRejection(
    kind: string,
    id: string,
    requestStartedAt: number,
  ): Promise<boolean>;
  /** Marks the account used (an account test). */
  touch(kind: string, id: string): void;
}

/** What creates readers bound to a project, for code that serves one project at a time. */
export interface AccountScopes {
  reader(projectId?: string): AccountsReader;
}

export type AccountsServiceDeps = {
  repository: () => AccountRepository;
  /** The master key for the credential vault. */
  key: CredentialVaultDeps["key"];
  provider?: CredentialVaultDeps["provider"];
  /** The built-in `oauth2` provider's settings (its SSRF-guarded fetch). */
  oauth2?: CredentialVaultDeps["oauth2"];
  /** Runs extensions' credential code; its guarded fetch for sign-in origins. */
  extension?: CredentialVaultDeps["extension"];
  /** The kinds the registered extensions define, user-wide or per project. */
  definitions: () => readonly AccountDefinition[];
  projectExists: (projectId: string) => boolean;
  /** The name of the extension that defines (or defined) a kind, to say who an unavailable account waits for. */
  extensionOfKind?: (kind: string) => string | undefined;
  /** The platform uses that widen sign-in scopes, per account level. Absent: definitions are used as declared. */
  platformUses?: PlatformUseSource;
  now?: () => Date;
};

const record = (row: AccountRow): AccountRecord => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  fields: { ...row.fields },
  level: levelOf(row),
  ...(row.projectId ? { projectId: row.projectId } : {}),
});

/** Accounts of extension account kinds, in the `account` table; their credentials are the vault's. */
export class AccountsService implements AccountScopes {
  readonly vault: CredentialVault;

  constructor(private readonly deps: AccountsServiceDeps) {
    // Kinds are unique across the built-in and user extensions; a duplicate is a registry error.
    assertUniqueAccountKinds([
      {
        id: "extensions",
        accounts: deps
          .definitions()
          .filter((definition) => definition.projectId === undefined)
          .map(({ kind }) => kind),
      },
    ]);
    this.vault = new CredentialVault({
      repository: deps.repository,
      key: deps.key,
      definition: (row) => this.#definitionOf(row)?.kind,
      credentialCode: (row) => this.#definitionOf(row)?.credentials,
      ...(deps.provider ? { provider: deps.provider } : {}),
      ...(deps.oauth2 ? { oauth2: deps.oauth2 } : {}),
      ...(deps.extension ? { extension: deps.extension } : {}),
      ...(deps.now ? { now: deps.now } : {}),
    });
  }

  #repository(): AccountRepository {
    return this.deps.repository();
  }

  #row(kind: string, id: string): AccountRow {
    const row = this.#repository().get(id);
    if (!row || row.kind !== kind)
      throw new ApplicationError(
        404,
        "ACCOUNT_NOT_FOUND",
        `Account '${id}' does not exist.`,
      );
    return row;
  }

  /** The definition of a kind that may hold accounts at `projectId` (null: user level). */
  #definition(kind: string, projectId: string | null): AccountDefinition {
    const candidates = this.deps
      .definitions()
      .filter((definition) => definition.kind.kind === kind);
    if (candidates.length === 0)
      throw new ApplicationError(
        404,
        "ACCOUNT_KIND_NOT_FOUND",
        `No extension defines the account kind '${kind}'.`,
      );
    const found = candidates.find((definition) =>
      allowsLevel(definition, projectId),
    );
    if (!found)
      throw new ApplicationError(
        400,
        "ACCOUNT_LEVEL_NOT_ALLOWED",
        candidates[0].projectId === undefined
          ? `The ${candidates[0].kind.label} cannot be saved there.`
          : `The ${candidates[0].kind.label} is defined by a project; its accounts belong to that project.`,
      );
    return { ...found, kind: this.#withUses(found.kind, projectId) };
  }

  /** The definition as sign-in sees it: its scopes plus those of the extensions enabled for accounts at this level. */
  #withUses(kind: AccountKind, projectId: string | null): AccountKind {
    const uses = this.deps.platformUses?.usesFor(projectId);
    return uses ? withScopeUnion(kind, uses) : kind;
  }

  #definitionOf(row: AccountRow): AccountDefinition | undefined {
    const found = definitionOf(this.deps.definitions(), row);
    return (
      found && { ...found, kind: this.#withUses(found.kind, row.projectId) }
    );
  }

  /** Re-reads which extensions are enabled, before a read that depends on it. */
  async #fresh(): Promise<void> {
    await this.deps.platformUses?.refresh();
  }

  #checkProject(projectId: string | null): void {
    if (projectId !== null && !this.deps.projectExists(projectId))
      throw new ApplicationError(
        404,
        "PROJECT_NOT_FOUND",
        `Project '${projectId}' does not exist.`,
      );
  }

  #provider(row: AccountRow, kind: AccountKind): ProviderAccount {
    const credentials = this.#definitionOf(row)?.credentials;
    return {
      id: row.id,
      kind,
      fields: row.fields,
      ...(credentials ? { credentials } : {}),
    };
  }

  /** The kinds the registered extensions define (one entry per kind name). */
  kinds(): readonly AccountKind[] {
    const kinds = new Map<string, AccountKind>();
    for (const { kind } of this.deps.definitions())
      if (!kinds.has(kind.kind)) kinds.set(kind.kind, kind);
    return [...kinds.values()];
  }

  /** Readers bound to a project (or to none); `all` sees every level, for the host's own checks. */
  reader(projectId?: string): AccountsReader {
    return this.#reader({ projectId });
  }

  /** Every account whatever its level, for the Accounts page and account tests. */
  all(): AccountsReader {
    return this.#reader({ all: true });
  }

  #reader(scope: {
    projectId?: string | undefined;
    all?: boolean;
  }): AccountsReader {
    const find = (
      kind: string,
      id: string,
      userLevelOnly?: boolean,
    ): AccountRow | undefined => {
      const row = this.#repository().get(id);
      return row &&
        row.kind === kind &&
        (scope.all ||
          visibleTo(row, { projectId: scope.projectId, userLevelOnly }))
        ? row
        : undefined;
    };
    return {
      platformKinds: (platform) =>
        this.deps
          .definitions()
          .filter(
            (definition) =>
              definition.kind.platform === platform &&
              (scope.all ||
                definition.projectId === undefined ||
                definition.projectId === scope.projectId),
          )
          .map(({ kind }) => kind),
      get: async (kind, id, options) => {
        const row = find(kind, id, options?.userLevelOnly);
        if (!row) return undefined;
        const identity = await this.vault.identityOf(row);
        return { ...record(row), ...(identity ? { identity } : {}) };
      },
      list: async (kind) =>
        (scope.all
          ? this.#repository()
              .list()
              .filter((row) => row.kind === kind)
          : this.#repository().listVisible(scope.projectId ?? null, kind)
        ).map(record),
      state: async (kind, id) => {
        await this.#fresh();
        const row = find(kind, id);
        return row ? (await this.vault.stateOf(row)).state : "needs_sign_in";
      },
      problem: async (kind, id) => {
        await this.#fresh();
        const row = find(kind, id);
        return row ? (await this.vault.stateOf(row)).error : undefined;
      },
      apply: async (kind, id, request) => {
        await this.#fresh();
        const row = find(kind, id);
        if (!row) return { ok: false, state: "needs_sign_in" };
        const definition = this.#definitionOf(row);
        if (!definition) return { ok: false, state: "unavailable" };
        return await this.vault.apply(
          this.#provider(row, definition.kind),
          request,
        );
      },
      refreshAfterRejection: async (kind, id, requestStartedAt) => {
        await this.#fresh();
        const row = find(kind, id);
        const definition = row && this.#definitionOf(row);
        return row && definition
          ? await this.vault.refreshAfterRejection(
              this.#provider(row, definition.kind),
              requestStartedAt,
            )
          : false;
      },
      touch: (kind, id) => {
        if (find(kind, id)) this.vault.touch(id);
      },
    };
  }

  /** Accounts for the app: every account, or those a project sees. */
  async views(projectId?: string): Promise<AccountView[]> {
    await this.#fresh();
    const rows = projectId
      ? this.#repository().listVisible(projectId)
      : this.#repository().list();
    return await Promise.all(rows.map((row) => this.#view(row)));
  }

  async view(kind: string, id: string): Promise<AccountView | undefined> {
    await this.#fresh();
    const row = this.#repository().get(id);
    return row && row.kind === kind ? await this.#view(row) : undefined;
  }

  async #view(row: AccountRow): Promise<AccountView> {
    const { state, error: reason } = await this.vault.stateOf(row);
    const extension =
      state === "unavailable"
        ? this.deps.extensionOfKind?.(row.kind)
        : undefined;
    const error =
      state === "unavailable"
        ? `Defined by ${extension ? `the ${extension} extension` : "an extension"} that is off or gone; the account comes back with it.`
        : reason;
    return {
      kind: row.kind,
      id: row.id,
      name: row.name,
      fields: { ...row.fields },
      level: levelOf(row),
      ...(row.projectId ? { projectId: row.projectId } : {}),
      state,
      ...(error ? { error } : {}),
    };
  }

  /**
   * Creates the account (no `id`), at user level or in `projectId`, or updates the name and
   * fields of an existing one (its level changes only through `move`).
   */
  save(input: {
    kind: string;
    id?: string;
    name: string;
    fields: Record<string, unknown>;
    projectId?: string;
  }): AccountRecord {
    const existing = input.id ? this.#row(input.kind, input.id) : undefined;
    const projectId = existing ? existing.projectId : (input.projectId ?? null);
    this.#checkProject(projectId);
    const definition = this.#definition(input.kind, projectId);
    const checked = validateAccountInput(definition.kind, input);
    if (!checked.ok)
      throw new ApplicationError(400, "ACCOUNT_INVALID", checked.message);
    const now = (this.deps.now?.() ?? new Date()).toISOString();
    if (existing) {
      this.#repository().updateDetails(existing.id, {
        name: checked.name,
        fields: checked.fields,
        updatedAt: now,
      });
      return record({
        ...existing,
        name: checked.name,
        fields: checked.fields,
        updatedAt: now,
      });
    }
    const row = {
      id: randomUUID(),
      kind: input.kind,
      projectId,
      name: checked.name,
      fields: checked.fields,
      status: "needs_sign_in",
      createdAt: now,
      updatedAt: now,
    } as const;
    this.#repository().insert(row);
    return record({
      ...row,
      hasCredential: false,
      expiresAt: null,
      lastUsedAt: null,
    });
  }

  /**
   * Stores typed-in secrets by name (names left out keep their value) and lets the kind's
   * provider act on them. Unknown names are rejected.
   */
  async setSecrets(
    kind: string,
    id: string,
    secrets: Record<string, string>,
  ): Promise<void> {
    const row = this.#row(kind, id);
    const definition = this.#definition(kind, row.projectId);
    const known = accountSecretFields(definition.kind);
    for (const name of Object.keys(secrets))
      if (!(name in known))
        throw new ApplicationError(
          400,
          "ACCOUNT_INVALID",
          `${definition.kind.label} has no secret '${name}'.`,
        );
    await this.vault.saveSecrets(this.#provider(row, definition.kind), secrets);
  }

  /** Moves the account to `projectId` (null: user level), keeping its credential. */
  move(kind: string, id: string, projectId: string | null): void {
    this.#row(kind, id);
    this.#checkProject(projectId);
    this.#definition(kind, projectId);
    this.#repository().move(
      id,
      projectId,
      (this.deps.now?.() ?? new Date()).toISOString(),
    );
  }

  /** Copies the account into `projectId` (null: user level) with its credential, under a new id. */
  async duplicate(
    kind: string,
    id: string,
    projectId: string | null,
    name?: string,
  ): Promise<AccountRecord> {
    const row = this.#row(kind, id);
    this.#checkProject(projectId);
    this.#definition(kind, projectId);
    const copyId = randomUUID();
    const sealed = await this.vault.reseal(id, copyId);
    const now = (this.deps.now?.() ?? new Date()).toISOString();
    const copy = {
      id: copyId,
      kind,
      projectId,
      name: (name ?? `${row.name} (copy)`).slice(0, 128),
      fields: { ...row.fields },
      createdAt: now,
      updatedAt: now,
      ...(sealed
        ? {
            credential: sealed.credential,
            status: sealed.status,
            expiresAt: sealed.expiresAt,
          }
        : { status: "needs_sign_in" as const }),
    };
    this.#repository().insert(copy);
    return record({
      ...copy,
      hasCredential: sealed !== null,
      status: copy.status,
      expiresAt: null,
      lastUsedAt: null,
    });
  }

  /**
   * What the sign-in service needs to sign an account in: who it is and what to run. The login
   * fails with the provider's message when it ends without a credential; one that is only
   * cancelled or timed out leaves the account as it was.
   */
  signInFlow(
    kind: string,
    id: string,
  ): {
    target: { kind: string; id: string; name: string };
    login: (interaction: SignInInteraction) => Promise<void>;
  } {
    const row = this.#row(kind, id);
    const definition = this.#definition(kind, row.projectId);
    if (!definition.kind.provider)
      throw new ApplicationError(
        400,
        "ACCOUNT_SIGN_IN_UNSUPPORTED",
        `${definition.kind.label} has no sign-in: add its secrets instead.`,
      );
    return {
      target: { kind, id, name: row.name },
      login: async (interaction) => {
        // The scopes asked for are the definition's and those of the extensions enabled now.
        await this.#fresh();
        const account = this.#provider(
          row,
          this.#definition(kind, row.projectId).kind,
        );
        const outcome = await this.vault.signIn(account, interaction);
        if (outcome.status !== "ready")
          throw new Error(outcome.message ?? "Sign-in did not complete.");
      },
    };
  }

  /** Forgets the stored credential; the account then needs sign-in. */
  async clearCredentials(kind: string, id: string): Promise<void> {
    this.#row(kind, id);
    await this.vault.clear(id);
  }

  /** Revokes (best effort) and removes the account; false when it did not exist. */
  async delete(kind: string, id: string): Promise<boolean> {
    const row = this.#repository().get(id);
    if (!row || row.kind !== kind) return false;
    const definition = this.#definitionOf(row);
    if (definition)
      await this.vault.revoke(this.#provider(row, definition.kind));
    this.#repository().delete(id);
    return true;
  }
}
