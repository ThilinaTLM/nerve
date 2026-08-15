import assert from "node:assert/strict";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import type { StorageMigration } from "../src/infrastructure/migrations/index.js";
import { migrationChecksum } from "../src/infrastructure/migrations/checksum.js";
import { migration0004 } from "../src/infrastructure/migrations/migrations/0004-dense-event-stream-layout.js";
import {
  ledgerDigest,
  readLedger,
} from "../src/infrastructure/migrations/ledger.js";
import { createRollbackBundle } from "../src/infrastructure/migrations/rollback-bundle.js";
import { runStorageMigrations } from "../src/infrastructure/migrations/runner.js";

const roots: string[] = [];
after(async () =>
  Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))),
);
async function home() {
  const value = await mkdtemp(join(tmpdir(), "nerve-migrations-"));
  roots.push(value);
  return value;
}
function migration(
  id: string,
  behavior: Partial<StorageMigration> = {},
): StorageMigration {
  return {
    id,
    checksum: migrationChecksum(`${id}|test-v1`),
    description: id,
    detect: async () => "current",
    backup: async () => ({ paths: [] }),
    up: async () => undefined,
    verify: async () => undefined,
    ...behavior,
  };
}

describe("storage migration runner", () => {
  it("accepts active dense journals after their layout marker exists", async () => {
    const root = await home();
    await mkdir(join(root, "logs"), { recursive: true });
    await writeFile(join(root, "logs", ".dense-streams-v1"), "{}\n");
    await writeFile(join(root, "logs", "workspace-events.jsonl"), "");
    await writeFile(join(root, "logs", "events.jsonl"), "");

    const report = await runStorageMigrations(root, {
      registry: [migration0004],
    });

    assert.equal(report.executions[0]?.execution, "detected");
    assert.equal(
      await readFile(join(root, "logs", "workspace-events.jsonl"), "utf8"),
      "",
    );
  });

  it("baselines current state without a rollback copy and reruns idempotently", async () => {
    const root = await home();
    const registry = [migration("0001-baseline")];
    const first = await runStorageMigrations(root, { registry });
    assert.equal(first.backupBytes, 0);
    assert.equal(first.executions[0]?.execution, "detected");
    const second = await runStorageMigrations(root, { registry });
    assert.equal(second.executions.length, 0);
    assert.equal(
      (await stat(join(root, "migrations", "ledger.json"))).mode & 0o777,
      0o600,
    );
  });

  it("creates one batch bundle, restores on failure, and leaves the ledger unchanged", async () => {
    const root = await home();
    const state = join(root, "state.txt");
    await writeFile(state, "before");
    let verifyCalls = 0;
    const registry = [
      migration("0001-write", {
        detect: async () => "pending",
        backup: async () => ({ paths: ["state.txt"] }),
        up: async () => writeFile(state, "first"),
      }),
      migration("0002-fail", {
        detect: async () => "pending",
        backup: async () => ({ paths: ["state.txt"] }),
        up: async () => writeFile(state, "second"),
        verify: async () => {
          verifyCalls += 1;
          throw new Error("injected verify failure");
        },
      }),
    ];
    await assert.rejects(runStorageMigrations(root, { registry }), /0002-fail/);
    assert.equal(await readFile(state, "utf8"), "before");
    assert.equal(verifyCalls, 1);
    await assert.rejects(
      readFile(join(root, "migrations", "ledger.json"), "utf8"),
      /ENOENT/,
    );
  });

  it("rejects a corrupted ledger and a live migration lock", async () => {
    const root = await home();
    await mkdir(join(root, "migrations"), { recursive: true });
    await writeFile(join(root, "migrations", "ledger.json"), "{bad json");
    await assert.rejects(
      runStorageMigrations(root, { registry: [] }),
      /ledger/i,
    );
    await writeFile(
      join(root, "migrations", "ledger.json"),
      JSON.stringify({ version: 1, applied: [] }),
    );
    await writeFile(
      join(root, "migrations", "lock.json"),
      JSON.stringify({
        pid: process.pid,
        hostname: "test",
        acquiredAt: new Date().toISOString(),
      }),
    );
    await assert.rejects(
      runStorageMigrations(root, { registry: [], lockTimeoutMs: 20 }),
      /lock/i,
    );
  });

  it("takes over a stale lock and recovers an interrupted batch before detection", async () => {
    const root = await home();
    await mkdir(join(root, "migrations"), { recursive: true });
    await writeFile(
      join(root, "migrations", "lock.json"),
      JSON.stringify({
        pid: 999_999_999,
        host: hostname(),
        startedAt: "2000-01-01T00:00:00.000Z",
      }),
    );
    const state = join(root, "state.txt");
    await writeFile(state, "before");
    const ledger = await readLedger(join(root, "migrations", "ledger.json"));
    await createRollbackBundle({
      home: root,
      migrationsDir: join(root, "migrations"),
      id: "interrupted-test",
      ledgerDigest: ledgerDigest(ledger),
      paths: ["state.txt"],
    });
    await writeFile(state, "interrupted");
    let observed = "";
    await runStorageMigrations(root, {
      registry: [
        migration("0001-recovered", {
          detect: async () => {
            observed = await readFile(state, "utf8");
            return "current";
          },
        }),
      ],
      lockTimeoutMs: 20,
    });
    assert.equal(observed, "before");
    assert.equal(await readFile(state, "utf8"), "before");
  });

  it("rejects symlinks in rollback scope without touching the target", async () => {
    const root = await home();
    const external = join(await home(), "outside.txt");
    await writeFile(external, "safe");
    await symlink(external, join(root, "linked.txt"));
    const registry = [
      migration("0001-link", {
        detect: async () => "pending",
        backup: async () => ({ paths: ["linked.txt"] }),
      }),
    ];
    await assert.rejects(
      runStorageMigrations(root, { registry }),
      /symbolic link/i,
    );
    assert.equal(await readFile(external, "utf8"), "safe");
    assert.equal(
      (await lstat(join(root, "linked.txt"))).isSymbolicLink(),
      true,
    );
  });
});
