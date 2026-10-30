import assert from "node:assert/strict";
import test from "node:test";
import { aggregateLosses } from "./report.js";

void test("report reasons aggregate identities without exposing absolute paths", () => {
  assert.deepEqual(
    aggregateLosses([
      {
        reason:
          "/home/test/data/conversations/a/config: Dropped legacy compaction field customKeepRecentPercent",
        count: 1,
      },
      {
        reason:
          "/home/test/data/conversations/b/config: Dropped legacy compaction field customKeepRecentPercent",
        count: 2,
      },
      {
        reason: "Converted metadata: /home/test/config/permissions.json",
        count: 1,
      },
    ]),
    [
      {
        reason: "Dropped legacy compaction field customKeepRecentPercent",
        count: 3,
      },
      { reason: "Converted metadata:", count: 1 },
    ],
  );
});

void test("reason labels preserve slashes that are not absolute paths", () => {
  assert.deepEqual(
    aggregateLosses([
      { reason: "Removed Explore/Developer behavior", count: 1 },
    ]),
    [{ reason: "Removed Explore/Developer behavior", count: 1 }],
  );
});
