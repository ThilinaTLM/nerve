import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { StorageCategoryUsage } from "@nervekit/contracts/storage";
import {
  BREAKDOWN_REST_TONE,
  percentLabel,
  storageBreakdown,
} from "./storage-format.js";

function category(
  key: StorageCategoryUsage["key"],
  bytes: number,
): StorageCategoryUsage {
  return {
    key,
    label: key,
    description: "",
    bytes,
    fileCount: 1,
    cleanable: false,
    protected: false,
  };
}

describe("storageBreakdown", () => {
  it("colours the four largest and folds sub-1% categories after them", () => {
    const { major, minor } = storageBreakdown(
      [
        category("logs", 160),
        category("cache", 5),
        category("payloads", 460),
        category("migrations", 0),
        category("database", 340),
        category("images", 20),
        category("plans", 4),
        category("other", 11),
      ],
      1_000,
    );
    assert.deepEqual(
      major.map((item) => item.key),
      ["payloads", "database", "logs", "images", "other"],
    );
    assert.equal(major[4].tone, BREAKDOWN_REST_TONE);
    assert.deepEqual(
      minor.map((item) => item.key),
      ["cache", "plans"],
    );
  });

  it("keeps the coloured categories even when they are tiny", () => {
    const { major, minor } = storageBreakdown(
      [category("database", 1_000_000), category("cache", 1)],
      1_000_001,
    );
    assert.equal(major.length, 2);
    assert.equal(minor.length, 0);
  });
});

describe("percentLabel", () => {
  it("never shows 0% for a non-empty share", () => {
    assert.equal(percentLabel(1, 1_000), "<1%");
    assert.equal(percentLabel(0, 1_000), "0%");
    assert.equal(percentLabel(460, 1_000), "46%");
  });
});
