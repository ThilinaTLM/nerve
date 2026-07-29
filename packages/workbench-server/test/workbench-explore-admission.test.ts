import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ExploreRunLimitError,
  WorkbenchExploreAdmission,
} from "../src/domains/agents/run/workbench-explore-admission.js";

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("WorkbenchExploreAdmission", () => {
  it("shares eight active slots across concurrent Explore calls", async () => {
    const admission = new WorkbenchExploreAdmission();
    const first = admission.reserveBatch("run_parent", 8);
    const second = admission.reserveBatch("run_parent", 8);
    const releases = await Promise.all(
      Array.from({ length: 8 }, () => first.acquire()),
    );
    let queued = false;
    let admitted = false;
    const waiting = second
      .acquire(undefined, () => {
        queued = true;
      })
      .then((release) => {
        admitted = true;
        return release;
      });

    await tick();
    assert.equal(queued, true);
    assert.equal(admitted, false);

    releases[0]!();
    const releaseWaiting = await waiting;
    assert.equal(admitted, true);

    releaseWaiting();
    for (const release of releases.slice(1)) release();
    first.finish();
    second.finish();
  });

  it("rejects a batch atomically when the parent run allowance is insufficient", () => {
    const admission = new WorkbenchExploreAdmission();
    admission.reserveBatch("run_parent", 8).finish();
    admission.reserveBatch("run_parent", 8).finish();
    admission.reserveBatch("run_parent", 4).finish();

    assert.throws(
      () => admission.reserveBatch("run_parent", 5),
      (error: unknown) => {
        assert.ok(error instanceof ExploreRunLimitError);
        assert.equal(error.requested, 5);
        assert.equal(error.used, 20);
        assert.equal(error.remaining, 4);
        assert.match(error.message, /No children were started/);
        assert.match(error.message, /Retry with at most 4 tasks/);
        return true;
      },
    );
  });

  it("explains when Explore is unavailable for the rest of a run", () => {
    const admission = new WorkbenchExploreAdmission();
    admission.reserveBatch("run_parent", 8).finish();
    admission.reserveBatch("run_parent", 8).finish();
    admission.reserveBatch("run_parent", 8).finish();

    assert.throws(
      () => admission.reserveBatch("run_parent", 1),
      /Explore is unavailable for the remainder of this parent run/,
    );

    admission.clearRun("run_parent");
    assert.doesNotThrow(() => admission.reserveBatch("run_parent", 8).finish());
  });

  it("removes an aborted queued acquisition without blocking later work", async () => {
    const admission = new WorkbenchExploreAdmission();
    const batch = admission.reserveBatch("run_parent", 8);
    const releases = await Promise.all(
      Array.from({ length: 8 }, () => batch.acquire()),
    );
    const controller = new AbortController();
    const aborted = batch.acquire(controller.signal);
    const later = batch.acquire();

    controller.abort();
    await assert.rejects(aborted, { name: "AbortError" });
    releases[0]!();
    const releaseLater = await later;

    releaseLater();
    for (const release of releases.slice(1)) release();
    batch.finish();
  });
});
