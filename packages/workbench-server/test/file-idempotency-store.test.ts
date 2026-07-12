import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { FileIdempotencyStore } from "../src/protocol/file-idempotency-store.js";

const success = { status: "success" as const, result: { id: "created" } };

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "nerve-idempotency-"));
  return join(dir, "protocol", "idempotency-v1.json");
}

test("file idempotency coalesces concurrent duplicates and survives reconstruction", async () => {
  const path = await fixture();
  const store = new FileIdempotencyStore(path);
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

  const reconstructed = new FileIdempotencyStore(path);
  const replay = await reconstructed.execute(
    "ui",
    "key-one",
    "project.create",
    { name: "one" },
    operation,
  );
  assert.equal(replay.status, "replayed");
  assert.equal(executions, 1);
  const conflict = await reconstructed.execute(
    "ui",
    "key-one",
    "project.create",
    { name: "different" },
    operation,
  );
  assert.equal(conflict.status, "conflict");
});

test("file idempotency persists bounded redacted errors without request params", async () => {
  const path = await fixture();
  const store = new FileIdempotencyStore(path);
  await store.execute(
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
  const persisted = await readFile(path, "utf8");
  assert.doesNotMatch(persisted, /raw-secret-value|Bearer/);
  assert.match(persisted, /\[REDACTED\]/);
});

test("file idempotency refuses unsafe successful outcomes", async () => {
  const unsafeResults: unknown[] = [
    { accessToken: "secret" },
    { url: "https://user:password@example.com/path" },
    { value: "x".repeat(70 * 1024) },
    new Uint8Array([1, 2, 3]),
  ];
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  unsafeResults.push(cyclic);

  for (const [index, result] of unsafeResults.entries()) {
    const path = await fixture();
    const execution = await new FileIdempotencyStore(path).execute(
      "ui",
      `key-unsafe-${index}`,
      "project.create",
      {},
      async () => ({ status: "success", result }),
    );
    assert.equal(execution.outcome.status, "error");
    const persisted = await readFile(path, "utf8");
    assert.doesNotMatch(persisted, /secret|user:password/);
  }
});

test("file idempotency writes private bounded state", async () => {
  const path = await fixture();
  await new FileIdempotencyStore(path).execute(
    "ui",
    "key-mode",
    "project.create",
    {},
    async () => success,
  );
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert((await readFile(path)).byteLength < 4 * 1024 * 1024);
});

test("file idempotency quarantines malformed state and starts clean", async () => {
  const path = await fixture();
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "not json", { encoding: "utf8", mode: 0o600 });
  const store = new FileIdempotencyStore(path);
  const result = await store.execute(
    "ui",
    "key-clean",
    "project.create",
    {},
    async () => success,
  );
  assert.equal(result.status, "executed");
});
