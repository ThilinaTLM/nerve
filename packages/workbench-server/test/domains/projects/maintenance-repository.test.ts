import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MaintenanceRepository } from "../../../src/domains/maintenance/maintenance.repository.js";
import { CanonicalStore } from "../../../src/infrastructure/persistence/canonical-sqlite/canonical-store.js";
test("latest-operation migration chooses the newest legacy record and is crash-idempotent", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-maintenance-migration-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const store = new CanonicalStore(join(home, "nerve.sqlite"));
  await store.initialize();
  const base = {
    status: "succeeded",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:00.000Z",
    message: "Complete",
    completedItems: 0,
    completedTargets: 1,
    totalTargets: 1,
    removedConversationCount: 0,
    removedTaskCount: 0,
    skippedActiveAgentCount: 0,
    skippedActiveTaskCount: 0,
    freedBytes: 10,
    results: [],
  };
  await store.writeDocument({
    namespace: "maintenance",
    scopeId: "global",
    documentId: "storage-cleanup",
    expectedRevision: 0,
    data: { ...base, id: "storageop_old", request: { clearCache: true } },
  });
  await store.writeDocument({
    namespace: "maintenance",
    scopeId: "global",
    documentId: "project-maintenance",
    expectedRevision: 0,
    data: {
      ...base,
      id: "projectop_new",
      updatedAt: "2026-02-01T00:00:00.000Z",
      status: "running",
      completedAt: undefined,
      kind: "delete_project",
      project: {
        id: "proj_test",
        name: "Project",
        dir: "/tmp/project",
        createdAt: base.createdAt,
        updatedAt: base.updatedAt,
      },
    },
  });
  const repository = new MaintenanceRepository(store);
  const operation = await repository.read();
  assert.equal(operation?.kind, "delete_project");
  assert.equal(operation?.status, "failed");
  assert.match(operation?.error ?? "", /daemon stopped/i);
  assert.equal(
    await store.readDocument("maintenance", "global", "storage-cleanup"),
    undefined,
  );
  assert.equal(
    await store.readDocument("maintenance", "global", "project-maintenance"),
    undefined,
  );
  assert.deepEqual(await repository.read(), operation);
  await store.close();
});
