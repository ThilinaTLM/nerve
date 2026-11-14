import { createHash } from "node:crypto";
import {
  accountHealthSchema,
  type AccountHealth,
  type IntegrationHealthStatus,
} from "@nervekit/contracts/auth";
import type { AccountKind } from "@nervekit/contracts/extensions";
import { ApplicationError } from "../../core/application-error.js";
import type {
  AccountRecord,
  AccountsReader,
} from "../accounts/accounts.service.js";

export type AccountTestResult = {
  status: IntegrationHealthStatus;
  message?: string;
};

/** Checks that an account's credentials work. Throws only when it cannot run the check. */
export type AccountTester = (
  account: AccountRecord,
  secret: string,
) => Promise<AccountTestResult>;

export type IntegrationHealthDeps = {
  accounts: AccountsReader;
  /** Account kinds the registered extensions define; only kinds that declare `test` are checked. */
  kinds: () => readonly AccountKind[];
  /** The connection check per kind. */
  testers: Readonly<Record<string, AccountTester>>;
  publish: (kind: string, accountId: string) => Promise<void>;
  now?: () => Date;
};

type Stored = {
  result: AccountHealth;
  /** Fingerprint of the fields and secret that produced the result; never the secret. */
  fingerprint: string;
};

const key = (kind: string, id: string) => `${kind}\u0000${id}`;

/**
 * Tracks whether each account's credentials currently work, for kinds that can
 * be tested. A result is bound to the account's fields and secret, so editing
 * the account or replacing its secret invalidates it.
 */
export class IntegrationHealthService {
  readonly #health = new Map<string, Stored>();

  constructor(private readonly deps: IntegrationHealthDeps) {}

  #testable(kind: string): AccountKind | undefined {
    return this.deps
      .kinds()
      .find((candidate) => candidate.kind === kind && candidate.test);
  }

  async list(): Promise<AccountHealth[]> {
    const health: AccountHealth[] = [];
    for (const { kind, test } of this.deps.kinds()) {
      if (!test) continue;
      for (const account of await this.deps.accounts.list(kind)) {
        const current = await this.#current(account);
        if (current) health.push(current);
      }
    }
    return health;
  }

  async check(kind: string, id: string): Promise<AccountHealth> {
    const tester = this.#testable(kind) && this.deps.testers[kind];
    if (!tester)
      throw new ApplicationError(
        400,
        "ACCOUNT_NOT_TESTABLE",
        `Accounts of kind '${kind}' cannot be tested.`,
      );
    const account = await this.deps.accounts.get(kind, id);
    if (!account)
      throw new ApplicationError(
        404,
        "ACCOUNT_NOT_FOUND",
        `Account '${id}' does not exist.`,
      );
    const secret = await this.deps.accounts.secret(kind, id);
    if (!secret)
      throw new ApplicationError(
        400,
        "ACCOUNT_SECRET_MISSING",
        "Add the secret before testing this account.",
      );
    const outcome = await tester(account, secret);
    const result = accountHealthSchema.parse({
      kind,
      accountId: id,
      status: outcome.status,
      checkedAt: (this.deps.now?.() ?? new Date()).toISOString(),
      ...(outcome.message ? { message: outcome.message.slice(0, 2000) } : {}),
    });
    this.#health.set(key(kind, id), {
      result,
      fingerprint: fingerprint(account, secret),
    });
    await this.deps.publish(kind, id);
    return result;
  }

  async #current(account: AccountRecord): Promise<AccountHealth | undefined> {
    const stored = this.#health.get(key(account.kind, account.id));
    if (!stored) return undefined;
    const secret = await this.deps.accounts.secret(account.kind, account.id);
    return secret && stored.fingerprint === fingerprint(account, secret)
      ? stored.result
      : undefined;
  }
}

function fingerprint(account: AccountRecord, secret: string): string {
  return createHash("sha256")
    .update(JSON.stringify([account.name, account.fields, secret]))
    .digest("hex");
}
