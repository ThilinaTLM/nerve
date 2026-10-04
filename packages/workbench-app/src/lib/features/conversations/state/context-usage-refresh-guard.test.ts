import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ContextUsageRefreshGuard } from "./context-usage-refresh-guard";

describe("context usage refresh ordering", () => {
  it("rejects deferred reads invalidated by compaction, provider updates, or disposal", async () => {
    const guard = new ContextUsageRefreshGuard();
    let finish!: () => void;
    const deferred = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const accept = guard.begin("conversation");
    let tokens: number | null = 100_000;
    const pending = deferred.then(() => {
      if (accept()) tokens = 187_000;
    });
    assert.equal(tokens, 100_000);
    guard.invalidate("conversation");
    tokens = null;
    finish();
    await pending;
    assert.equal(tokens, null);
    const beforeProvider = guard.begin("conversation");
    guard.invalidate("conversation");
    tokens = 25_000;
    assert.equal(beforeProvider(), false);
    assert.equal(tokens, 25_000);
  });
  it("accepts only the newest request once while keeping conversations independent", () => {
    const guard = new ContextUsageRefreshGuard();
    const old = guard.begin("a");
    const other = guard.begin("b");
    const recent = guard.begin("a");
    assert.equal(old(), false);
    assert.equal(other(), true);
    assert.equal(recent(), true);
    assert.equal(recent(), false);
    const disposed = guard.begin("a");
    guard.invalidate("a");
    assert.equal(disposed(), false);
  });
});
