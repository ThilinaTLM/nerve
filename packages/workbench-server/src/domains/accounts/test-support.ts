import type { AccountState } from "@nervekit/contracts/settings";
import type {
  AccountRecord,
  AccountScopes,
  AccountsReader,
} from "./accounts.service.js";

/** An accounts reader over fixed records, for tests of code that only reads accounts. */
export function fakeAccountsReader(
  options: {
    accounts?: Pick<AccountRecord, "id" | "kind" | "name" | "fields">[];
    state?: AccountState;
    get?: AccountsReader["get"];
  } = {},
): AccountsReader {
  const records: AccountRecord[] = (options.accounts ?? []).map((account) => ({
    level: "user",
    ...account,
  }));
  return {
    get:
      options.get ??
      (async (kind, id) =>
        records.find((record) => record.kind === kind && record.id === id)),
    list: async (kind) => records.filter((record) => record.kind === kind),
    state: async () => options.state ?? "ready",
    apply: async () => ({
      ok: true,
      headers: { authorization: "Bearer fake" },
      query: {},
    }),
    refreshAfterRejection: async () => false,
    touch: () => {},
  };
}

export const fakeAccountScopes = (
  reader = fakeAccountsReader(),
): AccountScopes => ({
  reader: () => reader,
});
