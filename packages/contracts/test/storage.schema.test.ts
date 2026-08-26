import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  operationDefinition,
  storageCleanupOperationSchema,
  storageCleanupRequestSchema,
  storageUsageResponseSchema,
} from "../src/index.js";

describe("storage cleanup contracts", () => {
  it("validates the v1 home usage taxonomy", () => {
    const parsed = storageUsageResponseSchema.parse({
      homeDir: "/tmp/nerve-home",
      generatedAt: "2026-08-26T00:00:00.000Z",
      totalBytes: 12,
      categories: [
        {
          key: "database",
          label: "Canonical database",
          description: "Authoritative records.",
          bytes: 12,
          fileCount: 1,
          cleanable: false,
          protected: true,
        },
      ],
      cleanupTargets: [],
      database: { dbBytes: 12, walBytes: 0, shmBytes: 0 },
      conversations: { total: 0, largest: [] },
    });
    assert.equal(parsed.categories[0]?.key, "database");
    assert.equal(
      storageUsageResponseSchema.safeParse({
        ...parsed,
        homeDir: undefined,
        dataDir: parsed.homeDir,
      }).success,
      false,
    );
  });

  it("deliberately rejects completed legacy operations with old usage snapshots", () => {
    const now = "2026-08-26T00:00:00.000Z";
    const legacy = {
      id: "storageop_LEGACY",
      request: { clearCache: true },
      status: "succeeded",
      createdAt: now,
      updatedAt: now,
      completedAt: now,
      message: "Complete.",
      completedTargets: 1,
      totalTargets: 1,
      cancellable: false,
      cancellationRequested: false,
      freedBytes: 0,
      results: [],
      usage: {
        dataDir: "/tmp/nerve-home",
        generatedAt: now,
        totalBytes: 0,
        categories: [],
        cleanupTargets: [],
        sqlite: { dbBytes: 0, walBytes: 0, shmBytes: 0 },
        conversations: { total: 0, largest: [] },
      },
    };
    assert.equal(
      storageCleanupOperationSchema.safeParse(legacy).success,
      false,
    );
  });
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
    assert.equal(
      storageCleanupRequestSchema.safeParse({ clearCrashReports: true })
        .success,
      true,
    );
  });

  it("registers cleanup as an accepted operation with status and cancel methods", () => {
    assert.equal(operationDefinition("storage.cleanup").kind, "accepted_async");
    assert.equal(operationDefinition("storage.cleanup.get").kind, "read");
    assert.equal(
      operationDefinition("storage.cleanup.cancel").kind,
      "mutation",
    );
  });
});
