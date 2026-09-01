import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { initializeStorage } from "../../../src/infrastructure/storage-bootstrap/index.js";
import { OPERATIONAL_STATE_MIGRATION } from "../../../src/infrastructure/migrations/operational-state-to-sqlite.js";

async function legacyReadyHome(t: test.TestContext) {
  const home = await mkdtemp(join(tmpdir(), "nerve-operational-migration-"));
  const opened: Array<{ close(): Promise<void> }> = [];
  t.after(async () => {
    await Promise.all(opened.map((store) => store.close()));
    await rm(home, { recursive: true, force: true });
  });
  const first = await initializeStorage(home);
  await first.canonicalStore.close();
  const ledger = JSON.parse(
    await readFile(first.paths.migrationLedgerPath, "utf8"),
  );
  ledger.entries = ledger.entries.filter(
    (entry: { id?: string }) => entry.id !== OPERATIONAL_STATE_MIGRATION,
  );
  await writeFile(first.paths.migrationLedgerPath, JSON.stringify(ledger));
  return {
    home,
    paths: first.paths,
    track: (store: { close(): Promise<void> }) => opened.push(store),
  };
}

test("imports valid legacy operational state and removes legacy directories", async (t) => {
  const { home, paths, track } = await legacyReadyHome(t);
  const now = new Date().toISOString();
  await mkdir(join(home, "data", "idempotency"), { recursive: true });
  await mkdir(join(home, "data", "maintenance"), { recursive: true });
  await mkdir(join(home, "data", "permissions"), { recursive: true });
  await writeFile(
    join(home, "data", "idempotency", "http-v1.json"),
    JSON.stringify({
      version: 1,
      entries: [
        {
          scope: "ui",
          key: "valid",
          method: "project.create",
          paramsHash: "hash",
          outcome: { status: "success", result: { id: "created" } },
          expiresAt: Date.now() + 60_000,
        },
        {
          scope: "ui",
          key: "expired",
          method: "project.create",
          paramsHash: "hash",
          outcome: { status: "success", result: {} },
          expiresAt: 1,
        },
      ],
    }),
  );
  await writeFile(
    join(home, "data", "maintenance", "storage-cleanup.json"),
    JSON.stringify({
      id: "storageop_TEST",
      request: { clearCache: true },
      status: "running",
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      message: "Clearing cache…",
      completedTargets: 0,
      totalTargets: 1,
      cancellable: true,
      cancellationRequested: false,
      freedBytes: 0,
      results: [],
    }),
  );
  await writeFile(
    join(home, "data", "permissions", "project-trust.json"),
    JSON.stringify({
      version: 1,
      projects: {
        proj_test: {
          digest: `sha256:${"a".repeat(64)}`,
          trustedAt: now,
        },
      },
    }),
  );

  const storage = await initializeStorage(home);
  track(storage.canonicalStore);
  assert(await storage.canonicalStore.readRpcIdempotency("ui", "valid"));
  assert.equal(
    await storage.canonicalStore.readRpcIdempotency("ui", "expired"),
    undefined,
  );
  assert(
    await storage.canonicalStore.readDocument(
      "maintenance",
      "global",
      "storage-cleanup",
    ),
  );
  assert(
    await storage.canonicalStore.readDocument(
      "project-permission-trust",
      "global",
      "proj_test",
    ),
  );
  for (const name of ["idempotency", "maintenance", "permissions"])
    await assert.rejects(stat(join(paths.dataPath, name)), { code: "ENOENT" });
  const migratedLedger = JSON.parse(
    await readFile(paths.migrationLedgerPath, "utf8"),
  );
  assert(
    migratedLedger.entries.some(
      (entry: { id?: string }) => entry.id === OPERATIONAL_STATE_MIGRATION,
    ),
  );
});

test("quarantines malformed trust without activating it", async (t) => {
  const { home, paths, track } = await legacyReadyHome(t);
  const permissionDir = join(home, "data", "permissions");
  await mkdir(permissionDir, { recursive: true });
  await writeFile(join(permissionDir, "project-trust.json"), "not json");
  const storage = await initializeStorage(home);
  track(storage.canonicalStore);
  assert.equal(
    await storage.canonicalStore.readDocument(
      "project-permission-trust",
      "global",
      "proj_test",
    ),
    undefined,
  );
  assert.equal(
    (
      await stat(
        join(
          paths.migrationsPath,
          OPERATIONAL_STATE_MIGRATION,
          "invalid-project-trust.json",
        ),
      )
    ).isFile(),
    true,
  );
});
