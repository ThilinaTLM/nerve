import assert from "node:assert/strict";
import { test } from "node:test";
import { ActivityService } from "./activity.service.js";
import { MaintenanceActivityProducer } from "./maintenance-activity-producer.js";
import { MaintenanceService } from "../maintenance/maintenance.service.js";

void test("maintenance adapter preserves exclusivity, safe cancellation and Settings lifecycle", async () => {
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const activities = new ActivityService(() => undefined);
  const adapter: MaintenanceActivityProducer = new MaintenanceActivityProducer(
    activities,
    (id) => service.cancel(id),
  );
  const service: MaintenanceService = new MaintenanceService({
    repository: { read: async () => null, write: async () => undefined },
    publish: async (operation) => adapter.report(operation),
    execute: async () => {
      entered();
      await gate;
    },
    getProject: () => {
      throw new Error("Unused");
    },
    reserveProject: () => () => undefined,
    warn: async () => undefined,
  });
  const accepted = await service.start({
    kind: "storage_cleanup",
    parameters: { clearCache: true },
  });
  await started;
  await assert.rejects(
    service.start({
      kind: "storage_cleanup",
      parameters: { clearCache: true },
    }),
    /already in progress/,
  );
  assert.equal(activities.list()[0].id, accepted.id);
  assert.equal((await activities.cancel(accepted.id)).accepted, true);
  assert.equal(service.get()?.status, "cancelling");
  assert.equal(activities.list()[0].status, "running");
  assert.equal(activities.list()[0].actions.cancel, false);
  release();
  await service.shutdown();
  assert.equal(service.get()?.status, "cancelled");
  assert.equal(activities.list()[0].status, "cancelled");
  assert.equal(activities.list()[0].actions.retry, false);
});

void test("non-cancellable project deletion and failure keep scope/error visible", async () => {
  const activities = new ActivityService(() => undefined);
  const adapter: MaintenanceActivityProducer = new MaintenanceActivityProducer(
    activities,
    (id) => service.cancel(id),
  );
  const service: MaintenanceService = new MaintenanceService({
    repository: { read: async () => null, write: async () => undefined },
    publish: async (operation) => adapter.report(operation),
    execute: async () => {
      throw new Error("Safe test failure");
    },
    getProject: () => ({
      id: "proj_test",
      name: "Synthetic project",
      directory: "/synthetic",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }),
    reserveProject: () => () => undefined,
    warn: async () => undefined,
  });
  const operation = await service.start({
    kind: "delete_project",
    projectId: "proj_test",
  });
  assert.equal((await activities.cancel(operation.id)).accepted, false);
  await service.shutdown();
  assert.equal(activities.list()[0].status, "failed");
  assert.equal(activities.list()[0].scope?.projectName, "Synthetic project");
  assert.match(activities.list()[0].error?.message ?? "", /See Settings/);
  assert.doesNotMatch(
    activities.list()[0].error?.message ?? "",
    /Safe test failure/,
  );
});
