import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCleanupRequest,
  EMPTY_CLEANUP_SELECTION,
  recommendedCleanupSelection,
  selectedFootprint,
  selectedTargets,
  targetLabel,
} from "./storage-cleanup.js";

describe("storage cleanup selection", () => {
  it("maps crash report selection into the cleanup request and targets", () => {
    const selection = {
      ...EMPTY_CLEANUP_SELECTION,
      crashReports: true,
    };

    assert.deepEqual(buildCleanupRequest(selection), {
      clearCrashReports: true,
    });
    assert.deepEqual(selectedTargets(selection), ["crashReports"]);
    assert.equal(targetLabel("crashReports"), "Crash reports");
    assert.deepEqual(
      selectedFootprint(selection, [
        {
          target: "crashReports",
          bytes: 4_096,
          itemCount: 2,
          estimate: "exact",
        },
      ]),
      { bytes: 4_096, upTo: false },
    );
  });

  it("includes disposable crash reports in recommended cleanup", () => {
    assert.equal(recommendedCleanupSelection().crashReports, true);
    assert.equal(EMPTY_CLEANUP_SELECTION.crashReports, false);
  });
});
