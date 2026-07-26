import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compactionCardBodyKind,
  compactionCardLayoutRevision,
} from "./compaction-card-layout";

function runningRevision(previewText: string, footerItemCount = 2): string {
  return compactionCardLayoutRevision({
    state: "running",
    bodyKind: compactionCardBodyKind({
      bodyVisible: true,
      previewVisible: previewText.length > 0,
    }),
    errorVisible: false,
    footerItemCount,
  });
}

describe("compaction card layout revision", () => {
  it("changes once when the running placeholder becomes a preview", () => {
    assert.notEqual(runningRevision(""), runningRevision("First token"));
  });

  it("stays stable while preview text streams into the same structure", () => {
    assert.equal(
      runningRevision("First token"),
      runningRevision("First token and many later streamed tokens"),
    );
  });

  it("changes for actual structural milestones", () => {
    const running = runningRevision("Preview");
    assert.notEqual(running, runningRevision("Preview", 3));
    assert.notEqual(
      running,
      compactionCardLayoutRevision({
        state: "completed",
        bodyKind: "preview",
        errorVisible: false,
        footerItemCount: 2,
      }),
    );
    assert.notEqual(
      running,
      compactionCardLayoutRevision({
        state: "running",
        bodyKind: "preview",
        errorVisible: true,
        footerItemCount: 2,
      }),
    );
    assert.notEqual(
      running,
      compactionCardLayoutRevision({
        state: "running",
        bodyKind: "none",
        errorVisible: false,
        footerItemCount: 2,
      }),
    );
  });
});
