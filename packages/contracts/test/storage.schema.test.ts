import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  operationDefinition,
  storageCleanupRequestSchema,
} from "../src/index.js";

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
    assert.equal(operationDefinition("storage.cleanup").kind, "accepted_async");
    assert.equal(operationDefinition("storage.cleanup.get").kind, "read");
    assert.equal(
      operationDefinition("storage.cleanup.cancel").kind,
      "mutation",
    );
  });
});
