import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AccountKind } from "@nervekit/contracts/extensions";
import type { AccountView } from "@nervekit/contracts/settings";
import {
  accountRows,
  duplicateWarning,
  filterAccountRows,
  levelChoices,
  noAccountFilters,
  visibleAccounts,
  type AccountExtension,
} from "./accounts-view";

const kind = (name: string): AccountKind => ({
  kind: name,
  label: `${name} account`,
  fields: {},
  secret: { label: "Key" },
});
const kinds = [kind("tavily"), kind("jira")];
const account = (over: Partial<AccountView>): AccountView => ({
  kind: "tavily",
  id: "a",
  name: "A",
  fields: {},
  level: "user",
  state: "ready",
  ...over,
});
const icon = { type: "lucide", name: "blocks" } as const;
const extensions: Record<string, AccountExtension> = {
  tavily: { id: "web", name: "Web", icon: icon, projectOnly: false },
  jira: { id: "jira-ext", name: "Jira", icon: icon, projectOnly: true },
};
const rowsOf = (accounts: AccountView[]) =>
  accountRows(accounts, kinds, (k) => extensions[k]);

describe("accounts page", () => {
  it("lists user-level accounts and the open project's only", () => {
    const all = [
      account({ id: "u" }),
      account({ id: "p1", level: "project", projectId: "one" }),
      account({ id: "p2", level: "project", projectId: "two" }),
    ];
    assert.deepEqual(
      visibleAccounts(all, "one").map((a) => a.id),
      ["u", "p1"],
    );
    assert.deepEqual(
      visibleAccounts(all, undefined).map((a) => a.id),
      ["u"],
    );
  });

  it("combines filters and ignores empty ones", () => {
    const rows = rowsOf([
      account({ id: "1" }),
      account({ id: "2", state: "needs_sign_in" }),
      account({ id: "3", kind: "jira", level: "project", projectId: "one" }),
    ]);
    const ids = (filters: Partial<typeof noAccountFilters>) =>
      filterAccountRows(rows, { ...noAccountFilters, ...filters }).map(
        (row) => row.account.id,
      );
    assert.deepEqual(ids({}), ["1", "2", "3"]);
    assert.deepEqual(ids({ extension: "web" }), ["1", "2"]);
    assert.deepEqual(ids({ extension: "web", state: "needs_sign_in" }), ["2"]);
    assert.deepEqual(ids({ level: "project" }), ["3"]);
    assert.deepEqual(ids({ kind: "jira", state: "failed" }), []);
  });

  it("offers the moves a level allows", () => {
    const [user, project, pinned] = rowsOf([
      account({}),
      account({ level: "project", projectId: "one" }),
      account({ kind: "jira", level: "project", projectId: "one" }),
    ]);
    assert.deepEqual(levelChoices(user!, "one"), {
      move: "project",
      duplicate: ["user", "project"],
    });
    assert.deepEqual(levelChoices(user!, undefined), { duplicate: ["user"] });
    assert.deepEqual(levelChoices(project!, "one"), {
      move: "user",
      duplicate: ["user", "project"],
    });
    // A kind a project extension defines stays in its project.
    assert.deepEqual(levelChoices(pinned!, "one"), {
      duplicate: ["project"],
    });
  });

  it("warns about duplicating a signed-in account only", () => {
    const [ready, waiting] = rowsOf([
      account({}),
      account({ state: "needs_sign_in" }),
    ]);
    assert.match(duplicateWarning(ready!, true) ?? "", /signs the other out/);
    assert.equal(duplicateWarning(ready!, false), undefined);
    assert.equal(duplicateWarning(waiting!, true), undefined);
  });
});
