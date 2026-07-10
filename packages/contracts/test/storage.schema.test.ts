import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  protocolMethodDefinition,
  storageCleanupOperationSchema,
  storageCleanupRequestSchema,
  storageCleanupStatusResponseSchema,
  storageCleanupUpdatedEventSchema,
} from "../src/index.js";

const now = new Date().toISOString();
const operation = {
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
};

describe("storage cleanup contracts", () => {
  it("requires at least one valid cleanup target", () => {
    assert.equal(storageCleanupRequestSchema.safeParse({}).success, false);
    assert.equal(
      storageCleanupRequestSchema.safeParse({ conversationsOlderThanDays: 0 })
        .success,
      false,
    );
    assert.equal(
      storageCleanupRequestSchema.safeParse({ logsOlderThanDays: 7.5 }).success,
      false,
    );
    assert.equal(
      storageCleanupRequestSchema.safeParse({ rebuildSearchIndex: true })
        .success,
      true,
    );
  });

  it("registers cleanup as an accepted operation with status and cancel methods", () => {
    assert.equal(
      protocolMethodDefinition("storage.cleanup").kind,
      "accepted_async",
    );
    assert.equal(protocolMethodDefinition("storage.cleanup.get").kind, "read");
    assert.equal(
      protocolMethodDefinition("storage.cleanup.cancel").kind,
      "mutation",
    );
  });

  it("parses operation status and update payloads", () => {
    assert.equal(
      storageCleanupOperationSchema.parse(operation).id,
      "storageop_TEST",
    );
    assert.equal(
      storageCleanupUpdatedEventSchema.parse({ operation }).operation.status,
      "running",
    );
    assert.deepEqual(
      storageCleanupStatusResponseSchema.parse({ operation: null }),
      { operation: null },
    );
  });
});
