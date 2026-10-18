import assert from "node:assert/strict";
import { test } from "node:test";
import { createSearchIndex } from "@nervekit/native";
import { measureUnifiedJudgments } from "../../benchmarks/completion-unified-judgments.js";

void test("actual typed native index retains lexical judgments and supports contextual candidates beyond eight", async (t) => {
  const result = await measureUnifiedJudgments(createSearchIndex, 0);
  t.diagnostic(
    JSON.stringify(
      {
        synthetic: true,
        platform: `${result.platform}/${result.arch}`,
        original: result.lexical.original,
        adversarial: result.lexical.adversarial,
        misses: result.lexical.results.filter((item) => item.rank !== 1),
        sessionDiagnostics: result.lexical.sessionDiagnostics,
        providerCoverage: result.lexical.providerCoverage.metrics,
        actualNativePolicy: result.actualNativePolicy,
      },
      null,
      2,
    ),
  );
  assert.equal(result.lexical.original.count, 56);
  assert.equal(result.lexical.adversarial.count, 19);
  assert.equal(result.actualNativePolicy.metrics.count, 8);
  assert.equal(result.lexical.providerCoverage.metrics.count, 9);
  assert.equal(
    result.lexical.providerCoverage.metrics.top1,
    1,
    JSON.stringify(result.lexical.providerCoverage.results),
  );
  for (const query of ["tool:web_search", "skill:aurora", "profile:cobalt"]) {
    const discovered = result.lexical.providerCoverage.results.find(
      (item) => item.query === query,
    )!;
    assert.equal(discovered.enabled, false, query);
    assert.equal(discovered.available, true, query);
  }
  assert.equal(
    result.lexical.original.top1,
    1,
    JSON.stringify(result.lexical.original),
  );
  assert.equal(
    result.actualNativePolicy.metrics.top1,
    1,
    JSON.stringify(result.actualNativePolicy.results),
  );
  const rescued = result.actualNativePolicy.results.find(
    (item) => item.name === "context rescues lexical rank twelve",
  )!;
  assert.ok(
    rescued.lexicalRank > 8,
    `fixture must retrieve outside display cap, got lexical rank ${rescued.lexicalRank}`,
  );
  assert.equal(rescued.rank, 1);
  assert.equal(
    result.lexical.adversarial.top3,
    1,
    JSON.stringify(result.lexical.adversarial),
  );
});
