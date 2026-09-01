import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteIdempotencyStore } from "../../../src/adapters/protocol/sqlite-idempotency-store.js";
import { CanonicalStore } from "../../../src/infrastructure/persistence/canonical-sqlite/index.js";

const success = { status: "success" as const, result: { id: "created" } };

async function fixture(t: test.TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "nerve-idempotency-"));
  const path = join(dir, "nerve.sqlite");
  const canonical = new CanonicalStore(path);
  await canonical.initialize();
  t.after(async () => {
    await canonical.close().catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  });
  return { canonical, path };
}

test("SQLite idempotency coalesces duplicates and survives reconstruction", async (t) => {
  const { canonical, path } = await fixture(t);
  const store = new SqliteIdempotencyStore(canonical);
  let executions = 0;
  const operation = async () => {
    executions += 1;
    return success;
  };
  const [first, duplicate] = await Promise.all([
    store.execute(
      "ui",
      "key-one",
      "project.create",
      { name: "one" },
      operation,
    ),
    store.execute(
      "ui",
      "key-one",
      "project.create",
      { name: "one" },
      operation,
    ),
  ]);
  assert.equal(executions, 1);
  assert.deepEqual(first.outcome, success);
  assert.deepEqual(duplicate.outcome, success);

  await canonical.close();
  const reopened = new CanonicalStore(path);
  await reopened.initialize();
  t.after(() => reopened.close().catch(() => undefined));
  const reconstructed = new SqliteIdempotencyStore(reopened);
  assert.equal(
    (
      await reconstructed.execute(
        "ui",
        "key-one",
        "project.create",
        { name: "one" },
        operation,
      )
    ).status,
    "replayed",
  );
  assert.equal(executions, 1);
  assert.equal(
    (
      await reconstructed.execute(
        "ui",
        "key-one",
        "project.create",
        { name: "different" },
        operation,
      )
    ).status,
    "conflict",
  );
});

test("SQLite idempotency persists redacted errors without request params", async (t) => {
  const { canonical, path } = await fixture(t);
  await new SqliteIdempotencyStore(canonical).execute(
    "ui",
    "key-error",
    "project.create",
    { token: "raw-secret-value" },
    async () => ({
      status: "error",
      error: {
        code: "INTERNAL_ERROR",
        message: "safe failure",
        retryable: true,
        details: { authorization: "Bearer raw-secret-value" },
      },
    }),
  );
  await canonical.close();
  const persisted = await readFile(path);
  assert.doesNotMatch(persisted.toString("latin1"), /raw-secret-value|Bearer/);
});

test("SQLite idempotency refuses unsafe and oversized successful outcomes", async (t) => {
  const { canonical } = await fixture(t);
  const unsafeResults: unknown[] = [
    { accessToken: "secret" },
    { url: "https://user:password@example.com/path" },
    { value: "x".repeat(70 * 1024) },
    new Uint8Array([1, 2, 3]),
    Object.fromEntries(
      Array.from({ length: 5 }, (_, index) => [
        `part${index}`,
        "x".repeat(60 * 1024),
      ]),
    ),
  ];
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  unsafeResults.push(cyclic);
  for (const [index, result] of unsafeResults.entries()) {
    const execution = await new SqliteIdempotencyStore(canonical).execute(
      "ui",
      `key-unsafe-${index}`,
      "project.create",
      {},
      async () => ({ status: "success", result }),
    );
    assert.equal(execution.outcome.status, "error");
  }
});

test("SQLite idempotency expires and retains only the newest bound", async (t) => {
  const { canonical } = await fixture(t);
  let now = 100;
  const store = new SqliteIdempotencyStore(canonical, 10, 2, () => now);
  for (const key of ["one", "two", "three"])
    await store.execute("ui", key, "create", {}, async () => success);
  assert.equal(await canonical.readRpcIdempotency("ui", "one", now), undefined);
  assert(await canonical.readRpcIdempotency("ui", "three", now));
  now = 111;
  let executions = 0;
  assert.equal(
    (
      await store.execute("ui", "three", "create", {}, async () => {
        executions += 1;
        return success;
      })
    ).status,
    "executed",
  );
  assert.equal(executions, 1);
});
