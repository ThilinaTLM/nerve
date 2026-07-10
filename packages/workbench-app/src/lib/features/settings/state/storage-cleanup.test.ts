import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allCleanupSelection,
  buildCleanupRequest,
  cleanupProgress,
  cleanupSelectionError,
  EMPTY_CLEANUP_SELECTION,
  recommendedCleanupSelection,
  selectedFootprint,
  selectedTargets,
} from "./storage-cleanup.js";

describe("storage cleanup state", () => {
  it("builds recommended and all-target requests", () => {
    const recommended = recommendedCleanupSelection();
    assert.equal(recommended.conversations, false);
    assert.equal(recommended.searchIndex, false);
    assert.deepEqual(selectedTargets(recommended), [
      "datedLogs",
      "rotatedEventLog",
      "toolCallLog",
      "exploreReports",
      "cache",
      "tmp",
    ]);

    const all = allCleanupSelection({
      ...EMPTY_CLEANUP_SELECTION,
      conversationsDays: Number.NaN,
      logsDays: 90,
    });
    assert.equal(all.conversationsDays, 30);
    assert.equal(all.logsDays, 90);
    assert.equal(buildCleanupRequest(all)?.rebuildSearchIndex, true);
  });

  it("rejects invalid ages instead of silently changing the request", () => {
    const fractional = {
      ...EMPTY_CLEANUP_SELECTION,
      conversations: true,
      conversationsDays: 2.5,
    };
    assert.match(cleanupSelectionError(fractional) ?? "", /whole number/);
    assert.equal(buildCleanupRequest(fractional), undefined);
    const tooLarge = {
      ...EMPTY_CLEANUP_SELECTION,
      datedLogs: true,
      logsDays: 3651,
    };
    assert.equal(buildCleanupRequest(tooLarge), undefined);
  });

  it("summarizes selected footprints and operation progress", () => {
    const selection = {
      ...EMPTY_CLEANUP_SELECTION,
      cache: true,
      searchIndex: true,
    };
    assert.deepEqual(
      selectedFootprint(selection, [
        { target: "cache", bytes: 100, itemCount: 1, estimate: "exact" },
        { target: "searchIndex", bytes: 900, itemCount: 3, estimate: "upTo" },
      ]),
      { bytes: 1_000, upTo: true },
    );
    assert.equal(
      cleanupProgress({
        id: "storageop_TEST",
        request: { clearCache: true },
        status: "running",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        message: "Working",
        completedTargets: 1,
        totalTargets: 4,
        cancellable: true,
        cancellationRequested: false,
        freedBytes: 0,
        results: [],
      }),
      25,
    );
  });
});
