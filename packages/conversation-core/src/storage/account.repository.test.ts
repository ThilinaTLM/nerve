import assert from "node:assert/strict";
import { test } from "node:test";
import { AccountRepository, type NewAccount } from "./account.repository.js";
import { openCoreDatabase } from "./database.js";
import { migrate } from "./migrations.js";

function setup() {
  const db = openCoreDatabase(":memory:");
  migrate(db);
  const now = "2026-01-01T00:00:00.000Z";
  for (const id of ["p1", "p2"])
    db.sqlite
      .prepare(
        "INSERT INTO project (id, name, directory, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(id, id, `/tmp/${id}`, now, now);
  const accounts = new AccountRepository(db);
  const account = (
    id: string,
    patch: Partial<NewAccount> = {},
  ): NewAccount => ({
    id,
    kind: "jira",
    projectId: null,
    name: id,
    fields: { site: "https://a.example" },
    status: "ready",
    createdAt: now,
    updatedAt: now,
    ...patch,
  });
  return { db, accounts, account };
}

test("a project lists user-level accounts and its own, never another project's", () => {
  const { db, accounts, account } = setup();
  accounts.insert(account("user"));
  accounts.insert(account("one", { projectId: "p1" }));
  accounts.insert(account("two", { projectId: "p2" }));
  accounts.insert(account("other-kind", { kind: "tavily" }));
  const ids = (rows: { id: string }[]) => rows.map((row) => row.id).sort();
  assert.deepEqual(ids(accounts.listVisible("p1", "jira")), ["one", "user"]);
  assert.deepEqual(ids(accounts.listVisible("p2")), [
    "other-kind",
    "two",
    "user",
  ]);
  assert.deepEqual(ids(accounts.listVisible(null)), ["other-kind", "user"]);
  assert.equal(accounts.list().length, 4);
  db.close();
});

test("rows never expose the credential; move, clear and delete change one row", () => {
  const { db, accounts, account } = setup();
  accounts.insert(account("a", { credential: Buffer.from("sealed") }));
  assert.equal(accounts.get("a")?.hasCredential, true);
  assert.equal(accounts.get("a")?.status, "ready");
  assert.equal("credential" in accounts.get("a")!, false);
  assert.equal(Buffer.from(accounts.readCredential("a")!).toString(), "sealed");
  accounts.move("a", "p1", "later");
  assert.equal(accounts.get("a")?.projectId, "p1");
  accounts.writeCredential("a", {
    credential: null,
    status: "needs_sign_in",
    expiresAt: null,
    updatedAt: "later",
  });
  assert.deepEqual(
    [accounts.get("a")?.hasCredential, accounts.get("a")?.status],
    [false, "needs_sign_in"],
  );
  accounts.delete("a");
  assert.equal(accounts.get("a"), null);
  db.close();
});

test("the refresh sweep finds ready accounts that expire soon and were used recently", () => {
  const { db, accounts, account } = setup();
  const sweep = { expiresBefore: "2026-06-01", usedAfter: "2026-05-01" };
  accounts.insert(
    account("due", { expiresAt: "2026-05-31", lastUsedAt: "2026-05-20" }),
  );
  accounts.insert(
    account("later", { expiresAt: "2026-07-01", lastUsedAt: "2026-05-20" }),
  );
  accounts.insert(
    account("stale", { expiresAt: "2026-05-31", lastUsedAt: "2026-01-01" }),
  );
  accounts.insert(account("never-used", { expiresAt: "2026-05-31" }));
  accounts.insert(
    account("broken", {
      expiresAt: "2026-05-31",
      lastUsedAt: "2026-05-20",
      status: "failed",
    }),
  );
  accounts.insert(account("no-expiry", { lastUsedAt: "2026-05-20" }));
  assert.deepEqual(
    accounts.refreshCandidates(sweep).map((row) => row.id),
    ["due"],
  );
  const plan = db.sqlite
    .prepare(
      "EXPLAIN QUERY PLAN SELECT id FROM account WHERE expires_at IS NOT NULL AND expires_at < ? AND last_used_at > ? AND status = 'ready'",
    )
    .all("x", "y")
    .map((row) => String(row.detail))
    .join(" ");
  assert.match(plan, /account_refresh/);
  db.close();
});

test("deleting a project removes its accounts", () => {
  const { db, accounts, account } = setup();
  accounts.insert(account("one", { projectId: "p1" }));
  accounts.insert(account("user"));
  db.sqlite.exec("DELETE FROM project WHERE id = 'p1'");
  assert.deepEqual(
    accounts.list().map((row) => row.id),
    ["user"],
  );
  db.close();
});
