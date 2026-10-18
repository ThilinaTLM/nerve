import assert from "node:assert/strict";
import { test } from "node:test";
import { createSearchIndex } from "@nervekit/native";
import { emptyCompletionEvidence } from "../../benchmarks/completion-unified-judgments.js";

void test("actual empty @ blends bounded native-filtered context/usage/state seeds beyond main64 without static file prior", async (t) => {
  const evidence = await emptyCompletionEvidence(createSearchIndex);
  const initial = evidence.withinPool.results.find(
    (result) => result.query === "@",
  )!;
  assert.equal(initial.nativeCount, evidence.withinPool.documentCount);
  assert.equal(initial.visible[0]?.id, evidence.withinPool.wantedId);
  assert.equal(initial.visible[0]?.factors?.context, 1280);
  assert.ok(initial.visible[0]!.factors!.usage > 0);
  assert.equal(initial.visible[1]?.label, "@tool:web_search");
  assert.ok(
    initial.visible.some(
      (item) => item.kind === "launch" && item.factors?.state === 80,
    ),
  );
  assert.ok(
    initial.nativeKinds.includes("file") &&
      initial.nativeKinds.includes("directory") &&
      initial.nativeKinds.includes("tool"),
  );
  for (const collection of [
    evidence.withinPool,
    evidence.denseWithinPool,
    evidence.crowded,
    evidence.beyondMain,
  ]) {
    assert.deepEqual(
      collection.results.find((result) => result.query === "")?.visible,
      collection.results.find((result) => result.query === "@")?.visible,
    );
    for (const result of collection.results) {
      assert.ok(result.allLexicalZero, result.query);
      assert.ok(
        result.visible.length > 0 && result.visible.length <= 8,
        result.query,
      );
    }
    const tools = collection.results.find(
      (result) => result.query === "@tool:",
    )!;
    assert.equal(tools.visible[0]?.label, "@tool:web_search");
    assert.ok(tools.visible[0]!.factors!.usage > 0);
    const launches = collection.results.find(
      (result) => result.query === "@launch:",
    )!;
    assert.equal(launches.visible[0]?.kind, "launch");
    assert.equal(launches.visible[0]?.factors?.state, 80);
    const agents = collection.results.find(
      (result) => result.query === "@agent:",
    )!;
    assert.equal(agents.visible[0]?.kind, "subagent");
    assert.equal(agents.visible[0]?.factors?.state, 80);
  }
  const dense = evidence.denseWithinPool.results.find(
    (result) => result.query === "@",
  )!;
  assert.equal(dense.nativeCount, evidence.denseWithinPool.documentCount);
  assert.ok(dense.nativeCount <= 64 && dense.nativeKinds.includes("launch"));
  assert.equal(dense.visible[0]?.id, evidence.denseWithinPool.wantedId);
  assert.equal(dense.visible[1]?.label, "@tool:web_search");
  assert.ok(
    dense.visible.some(
      (item) => item.kind === "launch" && item.factors?.state === 80,
    ),
    "without lexical intent, running state must not lose to a static file prior",
  );
  for (const [collection, wantedInMain, kinds] of [
    [evidence.crowded, true, ["file", "directory"]],
    [evidence.beyondMain, false, ["directory"]],
  ] as const)
    for (const query of ["", "@", "@file:"]) {
      const crowded = collection.results.find(
        (result) => result.query === query,
      )!;
      assert.equal(crowded.nativeCount, 64);
      assert.deepEqual(crowded.nativeKinds, kinds);
      assert.equal(
        crowded.nativeIds.includes(collection.wantedId),
        wantedInMain,
      );
      assert.equal(crowded.visible[0]?.id, collection.wantedId);
      assert.ok(
        crowded.visible[0]!.factors!.context > 0 &&
          crowded.visible[0]!.factors!.usage > 0,
      );
      assert.ok(crowded.visible.every((item) => item.factors?.prior === 0));
      if (query !== "@file:") {
        assert.equal(crowded.visible[1]?.label, "@tool:web_search");
        assert.ok(
          crowded.visible.some(
            (item) => item.kind === "launch" && item.factors?.state === 80,
          ),
        );
        assert.ok(
          crowded.visible.some(
            (item) => item.kind === "subagent" && item.factors?.state === 80,
          ),
        );
      } else
        assert.ok(
          crowded.visible.every(
            (item) => item.kind === "file" || item.kind === "directory",
          ),
        );
    }
  t.diagnostic(
    JSON.stringify({
      synthetic: true,
      withinPool: {
        documents: evidence.withinPool.documentCount,
        initial: initial.visible,
      },
      denseWithinPool: {
        documents: evidence.denseWithinPool.documentCount,
        runningStateVisible: true,
        filePrior: 0,
        runningState: 80,
      },
      crowded: {
        documents: evidence.crowded.documentCount,
        initialPoolKinds: evidence.crowded.results.find(
          (result) => result.query === "@",
        )?.nativeKinds,
        wantedInMainPoolByStructuralTie: true,
        usedToolAndRunningStateRetrievedByNativeFilteredSupplement: true,
      },
      beyondMain: {
        documents: evidence.beyondMain.documentCount,
        wantedOutsideMainPool: true,
        wantedRetrievedByNativeFilteredSupplement: true,
      },
      limit:
        "Empty native lexical scores are zero. Main64 plus at most256 known context/usage/state IDs, filtered by the same native query and kinds; policy only ranks native matches. Remaining recall outside both bounded sets is not guaranteed. No legacy empty-score parity or arbitrary recall claim.",
    }),
  );
});
