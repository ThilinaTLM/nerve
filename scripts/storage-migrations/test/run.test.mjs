import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runMigrationScript } from "../run.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));

test("migration commands prepare workspace dependencies before loading TypeScript", () => {
  for (const [command, script] of [
    ["check", "check.ts"],
    ["migrate", "migrate.ts"],
    ["rehearse", "rehearse.ts"],
    ["copy", "storage-copy.ts"],
    ["baseline", "rehearse-baseline.ts"],
  ]) {
    const calls = [];
    const args = ["--home", "/tmp/home with spaces", "--dry-run"];
    const status = runMigrationScript(command, args, (...call) => {
      calls.push(call);
      return { status: calls.length === 1 ? 0 : 7 };
    });
    assert.equal(status, 7);
    assert.deepEqual(calls, [
      [
        "pnpm",
        ["--filter", "@nervekit/workbench-server^...", "build"],
        { cwd: root, stdio: "inherit" },
      ],
      [
        "pnpm",
        ["exec", "tsx", `scripts/storage-migrations/${script}`, ...args],
        { cwd: root, stdio: "inherit" },
      ],
    ]);
  }
});

test("failed preparation never starts a migration script", () => {
  let calls = 0;
  assert.equal(
    runMigrationScript("migrate", [], () => {
      calls++;
      return { status: 2 };
    }),
    2,
  );
  assert.equal(calls, 1);
});

test("spawn failures and signals stop execution", () => {
  for (const result of [
    { error: new Error("spawn failed") },
    { signal: "SIGTERM" },
  ]) {
    let calls = 0;
    assert.throws(
      () =>
        runMigrationScript("check", [], () => {
          calls++;
          return result;
        }),
      /spawn failed|SIGTERM/,
    );
    assert.equal(calls, 1);
  }
});

test("unknown commands are rejected before preparation", () => {
  assert.throws(
    () =>
      runMigrationScript("unknown", [], () => {
        assert.fail("must not spawn");
      }),
    /Unknown storage migration command/,
  );
});
