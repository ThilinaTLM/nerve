import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { StorageRunGuard } from "./storage-run-guard.js";

describe("StorageRunGuard", () => {
  it("restarts after ending a run", () => {
    const guard = new StorageRunGuard();

    const first = guard.begin();
    assert.equal(guard.active, true);
    assert.equal(guard.isStale(first), false);

    guard.end();
    assert.equal(guard.active, false);
    assert.equal(guard.isStale(first), true);

    const second = guard.begin();
    assert.equal(guard.active, true);
    assert.equal(guard.isStale(second), false);
    assert.equal(guard.isStale(first), true);
  });

  it("treats responses from a previous run as stale", () => {
    const guard = new StorageRunGuard();
    const first = guard.begin();
    guard.end();
    guard.begin();

    assert.equal(guard.isStale(first), true);
  });
});
