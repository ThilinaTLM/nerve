import type { StorageCleanupOperation } from "@nervekit/contracts/storage";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  completionNotice,
  shouldAnnounceCompletion,
  shouldIgnoreOperationUpdate,
} from "./storage-operation.js";

function operation(
  overrides: Partial<StorageCleanupOperation> = {},
): StorageCleanupOperation {
  return {
    id: "storageop_1",
    request: { clearCache: true },
    status: "running",
    createdAt: "2026-07-30T10:00:00.000Z",
    updatedAt: "2026-07-30T10:00:05.000Z",
    message: "Clearing cache",
    completedTargets: 0,
    totalTargets: 1,
    cancellable: true,
    cancellationRequested: false,
    freedBytes: 0,
    results: [],
    ...overrides,
  };
}

const formatBytes = (bytes: number): string => `${bytes}B`;

describe("shouldIgnoreOperationUpdate", () => {
  it("ignores an older update for the tracked operation", () => {
    const current = operation();
    const stale = operation({ updatedAt: "2026-07-30T10:00:01.000Z" });
    assert.equal(shouldIgnoreOperationUpdate(current, stale), true);
  });

  it("accepts newer updates and different operations", () => {
    const current = operation();
    assert.equal(
      shouldIgnoreOperationUpdate(
        current,
        operation({ updatedAt: "2026-07-30T10:00:09.000Z" }),
      ),
      false,
    );
    assert.equal(
      shouldIgnoreOperationUpdate(
        current,
        operation({ id: "storageop_2", updatedAt: current.createdAt }),
      ),
      false,
    );
  });

  it("accepts clearing the operation and the first update", () => {
    assert.equal(shouldIgnoreOperationUpdate(operation(), null), false);
    assert.equal(shouldIgnoreOperationUpdate(null, operation()), false);
  });
});

describe("shouldAnnounceCompletion", () => {
  it("stays silent for a completed operation loaded from storage", () => {
    const done = operation({
      status: "succeeded",
      completedAt: "2026-07-30T10:01:00.000Z",
    });
    assert.equal(shouldAnnounceCompletion(null, done), false);
  });

  it("announces a transition from an active operation", () => {
    const done = operation({
      status: "succeeded",
      completedAt: "2026-07-30T10:01:00.000Z",
    });
    assert.equal(shouldAnnounceCompletion(operation(), done), true);
  });

  it("allows the operation start response to announce immediately", () => {
    const done = operation({
      status: "succeeded",
      completedAt: "2026-07-30T10:01:00.000Z",
    });
    assert.equal(
      shouldAnnounceCompletion(null, done, { explicit: true }),
      true,
    );
  });
});

describe("completionNotice", () => {
  it("returns nothing while the operation is unfinished", () => {
    assert.equal(completionNotice(operation(), { formatBytes }), undefined);
  });

  it("announces freed bytes once per operation", () => {
    const done = operation({
      status: "succeeded",
      completedAt: "2026-07-30T10:01:00.000Z",
      freedBytes: 2048,
    });
    assert.deepEqual(completionNotice(done, { formatBytes }), {
      kind: "success",
      message: "Freed 2048B",
    });
    assert.equal(
      completionNotice(done, {
        formatBytes,
        lastNotifiedOperationId: done.id,
      }),
      undefined,
    );
  });

  it("reports partial failures and failed runs", () => {
    const withIssues = operation({
      status: "succeeded",
      completedAt: "2026-07-30T10:01:00.000Z",
      results: [
        {
          target: "cache",
          outcome: "failed",
          freedBytes: 0,
          removedItems: 0,
          skipped: 0,
        },
      ],
    });
    assert.deepEqual(completionNotice(withIssues, { formatBytes }), {
      kind: "success",
      message: "Cleanup completed with issues",
    });

    const failed = operation({
      status: "failed",
      completedAt: "2026-07-30T10:01:00.000Z",
      error: "disk error",
    });
    assert.deepEqual(completionNotice(failed, { formatBytes }), {
      kind: "error",
      message: "Cleanup failed",
      description: "disk error",
    });
  });

  it("stays silent for cancelled operations", () => {
    const cancelled = operation({
      status: "cancelled",
      completedAt: "2026-07-30T10:01:00.000Z",
    });
    assert.equal(completionNotice(cancelled, { formatBytes }), undefined);
  });
});
