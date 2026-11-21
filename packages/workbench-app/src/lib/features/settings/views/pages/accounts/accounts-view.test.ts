import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AccountKind } from "@nervekit/contracts/extensions";
import type { AccountView } from "@nervekit/contracts/settings";
import {
  accountRows,
  duplicateWarning,
  accountProblem,
  facetOptions,
  filterAccountRows,
  kindsToAdd,
  levelChoices,
  noAccountFilters,
  platformsOfExtension,
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

describe("accounts of a platform", () => {
  const on = (name: string, platform: string): AccountKind => ({
    ...kind(name),
    platform,
  });
  const platformKinds = [
    on("gh-a", "github"),
    on("gh-b", "github"),
    on("jira", "jira"),
  ];
  const owners: Record<string, AccountExtension> = {
    "gh-a": { id: "ext-a", name: "A", icon, projectOnly: false },
    "gh-b": { id: "ext-b", name: "B", icon, projectOnly: false },
    jira: { id: "ext-j", name: "J", icon, projectOnly: false },
  };
  const rows = accountRows(
    [
      account({ id: "1", kind: "gh-a" }),
      account({ id: "2", kind: "gh-b" }),
      account({ id: "3", kind: "jira" }),
      account({ id: "4", kind: "gone", state: "unavailable" }),
    ],
    platformKinds,
    (k) => owners[k],
  );

  it("shows every account of a platform across the extensions that define it", () => {
    const ids = filterAccountRows(rows, {
      ...noAccountFilters,
      platform: "github",
    }).map((row) => row.account.id);
    assert.deepEqual(ids, ["1", "2"]);
    assert.deepEqual(facetOptions("platform", rows, platformKinds), [
      { value: "github", label: "github" },
      { value: "jira", label: "jira" },
    ]);
  });

  it("offers the platform's definitions when adding, narrowed by a kind filter", () => {
    const names = (platform: string, kindFilter = "") =>
      kindsToAdd(platformKinds, { platform, kind: kindFilter }).map(
        (k) => k.kind,
      );
    assert.deepEqual(names("github"), ["gh-a", "gh-b"]);
    assert.deepEqual(names("github", "gh-b"), ["gh-b"]);
    assert.deepEqual(names(""), ["gh-a", "gh-b", "jira"]);
  });

  it("links an extension page to the platforms it defines and uses", () => {
    assert.deepEqual(
      platformsOfExtension({
        accountKinds: [on("gh-a", "github"), kind("plain")],
        uses: [{ platform: "jira" }, { platform: "github" }],
      }),
      ["github", "jira"],
    );
  });

  it("says why an account is unavailable or needs more permissions", () => {
    assert.equal(
      accountProblem(
        account({ state: "unavailable", error: "Defined by the A extension." }),
      ),
      "Defined by the A extension.",
    );
    assert.equal(
      accountProblem(account({ state: "needs_sign_in", error: "more: repo" })),
      "more: repo",
    );
  });
});
