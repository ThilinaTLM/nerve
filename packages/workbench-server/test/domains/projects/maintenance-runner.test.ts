import assert from "node:assert/strict";
import test from "node:test";
import type {
  MaintenanceOperation,
  MaintenanceRequest,
} from "@nervekit/contracts/maintenance";
import {
  MaintenanceService,
  type MaintenanceServiceDeps,
} from "../../../src/domains/maintenance/maintenance.service.js";
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const storage: MaintenanceRequest = {
  kind: "storage_cleanup",
  parameters: { clearCache: true },
};
const project = {
  id: "proj_TEST",
  name: "Test",
  dir: "/tmp/maintenance-test",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};
function fixture(
  execute: MaintenanceServiceDeps["execute"],
  write?: MaintenanceServiceDeps["repository"]["write"],
) {
  const terminal = deferred<MaintenanceOperation>();
  const updates: MaintenanceOperation[] = [];
  const service = new MaintenanceService({
    repository: { read: async () => null, write: write ?? (async () => {}) },
    getProject: () => project,
    reserveProject: () => () => {},
    warn: async () => {},
    execute,
    publish: async (operation) => {
      updates.push(operation);
      if (operation.completedAt) terminal.resolve(operation);
    },
  });
  return { service, terminal: terminal.promise, updates };
}
test("shared lane reserves synchronously before queued persistence across all start kinds", async () => {
  const persistence = deferred();
  const entered = deferred();
  const release = deferred();
  const { service, terminal } = fixture(
    async () => {
      entered.resolve();
      await release.promise;
    },
    async (operation) => {
      if (operation.status === "queued") await persistence.promise;
    },
  );
  const accepted = service.start(storage);
  await assert.rejects(
    service.start({ kind: "delete_project", projectId: project.id }),
    /already in progress/,
  );
  persistence.resolve();
  const queued = await accepted;
  assert.equal(queued.status, "queued");
  await entered.promise;
  await assert.rejects(
    service.start({
      kind: "prune_conversations",
      projectId: project.id,
      parameters: { strategy: "completed" },
    }),
    /already in progress/,
  );
  release.resolve();
  assert.equal((await terminal).status, "succeeded");
  await service.shutdown();
});
test("cancellation survives progress, coalesces counters, and drains shutdown safely", async () => {
  const entered = deferred();
  const release = deferred();
  const { service, terminal, updates } = fixture(
    async (_request, execution) => {
      entered.resolve();
      await release.promise;
      for (let removedRows = 1; removedRows <= 100; removedRows++)
        await execution.report({
          currentItem: {
            conversationId: "conv_test",
            stage: "records",
            removedRows,
            detachedLinks: 0,
          },
        });
      assert.equal(execution.cancelled(), true);
      await execution.report({
        removedConversationCount: 1,
        completedItems: 1,
      });
    },
  );
  const queued = await service.start(storage);
  await entered.promise;
  await service.cancel(queued.id);
  release.resolve();
  const result = await terminal;
  assert.equal(result.status, "cancelled");
  assert.equal(result.removedConversationCount, 1);
  assert.ok(updates.length < 20);
  assert.ok(
    updates.every(
      (operation, index) =>
        index === 0 || operation.revision > updates[index - 1]!.revision,
    ),
  );
  const cancellingIndex = updates.findIndex(
    (operation) => operation.status === "cancelling",
  );
  assert.ok(
    updates
      .slice(cancellingIndex)
      .every((operation) => operation.cancellationRequested),
  );
  await service.shutdown();
  await assert.rejects(service.start(storage), /shutting down/);
});
test("executor rejection becomes a durable terminal failure without escaping the background task", async () => {
  const { service, terminal } = fixture(async () => {
    throw new Error("intentional target failure");
  });
  await service.start(storage);
  const failed = await terminal;
  assert.equal(failed.status, "failed");
  assert.match(failed.error!, /intentional target failure/);
  await service.shutdown();
});
