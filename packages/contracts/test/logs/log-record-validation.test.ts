import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applicationLogPruneRequestSchema,
  applicationLogQueryResponseSchema,
  applicationLogQuerySchema,
} from "../../src/domains/logs/index.js";

describe("application log paging schemas", () => {
  it("accepts either historical or newer cursors but not both", () => {
    assert.equal(
      applicationLogQuerySchema.safeParse({ beforeSeq: 42, limit: 20 }).success,
      true,
    );
    assert.equal(
      applicationLogQuerySchema.safeParse({ sinceSeq: 41, limit: 20 }).success,
      true,
    );
    assert.equal(
      applicationLogQuerySchema.safeParse({ beforeSeq: 42, sinceSeq: 41 })
        .success,
      false,
    );
  });

  it("requires historical page metadata in responses", () => {
    assert.equal(
      applicationLogQueryResponseSchema.safeParse({
        logs: [],
        nextCursor: 0,
        hasMoreBefore: false,
      }).success,
      true,
    );
    assert.equal(
      applicationLogQueryResponseSchema.safeParse({
        logs: [],
        nextCursor: 0,
      }).success,
      false,
    );
  });

  it("strips paging fields from prune requests", () => {
    assert.deepEqual(
      applicationLogPruneRequestSchema.parse({
        level: "warn",
        beforeSeq: 42,
        sinceSeq: 10,
        limit: 20,
      }),
      { level: "warn" },
    );
  });
});
