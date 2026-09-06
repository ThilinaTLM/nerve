import assert from "node:assert/strict";
import test from "node:test";
import type { MaintenanceOperation } from "@nervekit/contracts/maintenance";
import {
  MaintenanceController,
  shouldIgnoreMaintenanceUpdate,
} from "./maintenance-controller.js";
function operation(
  patch: Partial<MaintenanceOperation> = {},
): MaintenanceOperation {
  return {
    id: "maintenance_test",
    revision: 1,
    kind: "storage_cleanup",
    request: { kind: "storage_cleanup", parameters: { clearCache: true } },
    status: "running",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    phase: "cache",
    message: "Clearing cache",
    cancellable: true,
    cancellationRequested: false,
    completedItems: 0,
    completedTargets: 0,
    totalTargets: 1,
    removedConversationCount: 0,
    removedTaskCount: 0,
    skippedActiveAgentCount: 0,
    skippedActiveTaskCount: 0,
    freedBytes: 0,
    warnings: [],
    ...patch,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
test("revisions reject stale updates independently of timestamp precision", () => {
  assert.equal(
    shouldIgnoreMaintenanceUpdate(
      operation({ revision: 3 }),
      operation({ revision: 2 }),
    ),
    true,
  );
  assert.equal(
    shouldIgnoreMaintenanceUpdate(operation(), operation({ revision: 2 })),
    false,
  );
  assert.equal(shouldIgnoreMaintenanceUpdate(operation(), null), true);
});
test("one subscription/request survives reconnect and ignores disposed generations", async () => {
  const first = deferred<MaintenanceOperation | null>();
  const second = deferred<MaintenanceOperation | null>();
  let requests = 0;
  let subscriptions = 0;
  let changed = 0;
  const controller = new MaintenanceController({
    get: () => (++requests === 1 ? first.promise : second.promise),
    subscribe: () => {
      subscriptions++;
      return () => {
        subscriptions--;
      };
    },
    start: async () => operation(),
    cancel: async () => operation(),
    changed: () => {
      changed++;
    },
    terminal: async () => {},
    error: () => {},
  });
  controller.start();
  controller.start();
  controller.reconnect();
  assert.equal(requests, 1);
  assert.equal(subscriptions, 1);
  controller.dispose();
  controller.start();
  first.resolve(operation());
  await first.promise;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(changed, 0);
  assert.equal(requests, 2);
  second.resolve(operation({ id: "latest-operation" }));
  await controller.load();
  assert.equal(controller.operation?.id, "latest-operation");
  controller.dispose();
});
test("historical hydration stays silent; observed completion reconciles and announces only once", async () => {
  const historical = operation({
    status: "succeeded",
    completedAt: "2026-09-01T00:01:00.000Z",
  });
  let event!: (operation: MaintenanceOperation) => void;
  const announcements: boolean[] = [];
  const controller = new MaintenanceController({
    get: async () => historical,
    subscribe: (handler) => {
      event = handler;
      return () => {};
    },
    start: async () => operation(),
    cancel: async () => operation(),
    changed: () => {},
    terminal: async (_operation, announce) => {
      announcements.push(announce);
    },
    error: () => {},
  });
  controller.start();
  await controller.load();
  assert.deepEqual(announcements, [false]);
  const current = operation({
    id: "new-operation",
    createdAt: "2026-09-02T00:00:00.000Z",
  });
  event(current);
  event({
    ...current,
    revision: 2,
    currentItem: {
      conversationId: "conv_test",
      stage: "records",
      removedRows: 4500,
      detachedLinks: 0,
    },
  });
  assert.equal(controller.operation?.completedItems, 0);
  assert.equal(controller.operation?.currentItem?.removedRows, 4500);
  const terminal = {
    ...current,
    revision: 3,
    status: "cancelled" as const,
    completedAt: "2026-09-02T00:01:00.000Z",
  };
  event(terminal);
  event(terminal);
  assert.deepEqual(announcements, [false, true]);
  controller.dispose();
});
