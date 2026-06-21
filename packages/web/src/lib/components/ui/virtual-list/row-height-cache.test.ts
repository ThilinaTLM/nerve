import { strict as assert } from "node:assert";
import { afterEach, describe, it } from "node:test";
import { clearRowHeightCaches, getRowHeightCache } from "./row-height-cache";

afterEach(() => clearRowHeightCaches());

describe("row height cache", () => {
  it("stores and retrieves heights for a scope", () => {
    const cache = getRowHeightCache("conv-a");
    assert.equal(cache.get("row-1"), undefined);
    cache.set("row-1", 240);
    assert.equal(cache.get("row-1"), 240);
    assert.equal(cache.size, 1);
  });

  it("shares the same backing map for a repeated scope key", () => {
    getRowHeightCache("conv-a").set("row-1", 100);
    const again = getRowHeightCache("conv-a");
    assert.equal(again.get("row-1"), 100);
  });

  it("isolates heights between scopes", () => {
    getRowHeightCache("conv-a").set("row-1", 100);
    const other = getRowHeightCache("conv-b");
    assert.equal(other.get("row-1"), undefined);
    other.set("row-1", 50);
    assert.equal(getRowHeightCache("conv-a").get("row-1"), 100);
    assert.equal(getRowHeightCache("conv-b").get("row-1"), 50);
  });

  it("ignores non-positive heights (skipped/collapsed rows)", () => {
    const cache = getRowHeightCache("conv-a");
    cache.set("row-1", 0);
    cache.set("row-2", -10);
    assert.equal(cache.get("row-1"), undefined);
    assert.equal(cache.get("row-2"), undefined);
    assert.equal(cache.size, 0);
  });

  it("evicts the least-recently-used scope past capacity", () => {
    // Capacity is 12 scopes; create 13 and confirm the oldest is dropped.
    for (let i = 0; i < 13; i += 1) {
      getRowHeightCache(`conv-${i}`).set("row", i + 1);
    }
    // conv-0 was the oldest and should have been evicted (fresh empty map).
    assert.equal(getRowHeightCache("conv-0").get("row"), undefined);
    // A recent scope survives.
    assert.equal(getRowHeightCache("conv-12").get("row"), 13);
  });
});
