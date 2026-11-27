import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCleanupRequest,
  cleanupSelectionFor,
  EMPTY_CLEANUP_SELECTION,
  recommendedCleanupSelection,
  selectedFootprint,
  selectedTargets,
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

  it("selects exactly one target for a category's cleanup", () => {
    for (const target of [
      "conversations",
      "datedLogs",
      "rotatedEventLog",
      "crashReports",
      "cache",
      "tmp",
    ] as const)
      assert.deepEqual(selectedTargets(cleanupSelectionFor(target)), [target]);
  });

  it("includes disposable crash reports in recommended cleanup", () => {
    assert.equal(recommendedCleanupSelection().crashReports, true);
    assert.equal(EMPTY_CLEANUP_SELECTION.crashReports, false);
  });
});
