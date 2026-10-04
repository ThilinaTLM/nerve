import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import type { StopReason } from "@earendil-works/pi-ai";
import { registerManagedFauxProvider } from "../../src/models/model-registry.js";
import {
  compact,
  generateSummary,
  summaryBudget,
  summaryDefects,
} from "../../src/compaction/compaction.js";
import { createFileOps } from "../../src/compaction/file-operations.js";
import { user, validSummary } from "./compaction-fixtures.js";

let sequence = 0;
async function generate(
  drafts: Array<{ text: string; stopReason?: StopReason }>,
) {
  const registration = registerManagedFauxProvider({
    provider: `summary-test-${++sequence}`,
    models: [{ id: "summary", name: "Summary" }],
    tokensPerSecond: 100_000,
    tokenSize: { min: 128, max: 256 },
  });
  const prompts: string[] = [];
  registration.setResponses(
    drafts.map((draft) => async (context) => {
      prompts.push(JSON.stringify(context));
      return fauxAssistantMessage(draft.text, {
        stopReason: draft.stopReason ?? "stop",
      });
    }),
  );
  try {
    const result = await generateSummary({
      messages: [user("Never change the public API. Tests failed.")],
      previousSummary: validSummary,
      model: registration.getModel("summary"),
      reserveTokens: 16_384,
      apiKey: "",
      turnPrefixMessages: [user("Finish the in-progress edit")],
      onProgress: () => {},
    });
    return { result, prompts };
  } finally {
    registration.unregister();
  }
}

describe("bounded checkpoint generation", () => {
  it("separates text and reasoning completion budgets and rejects unusable budgets", () => {
    assert.deepEqual(summaryBudget(16_384), {
      target: 3_000,
      ceiling: 4_000,
      completionTokens: 13_107,
    });
    assert.equal(summaryBudget(2_000, 1_000).ceiling, 1_000);
    for (const reserve of [0, -1, Number.NaN, 500])
      assert.throws(() => summaryBudget(reserve));
  });
  it("passes source boundaries and numeric budgets, accepting a concise first draft", async () => {
    const { result, prompts } = await generate([{ text: validSummary }]);
    assert.ok(result.ok);
    assert.equal(prompts.length, 1);
    assert.match(prompts[0], /3000/);
    assert.match(prompts[0], /4000/);
    assert.match(prompts[0], /removed-turn-prefix/);
    assert.match(prompts[0], /previous-summary/);
    assert.match(prompts[0], /untrusted source data/);
  });
  it("repairs oversize, malformed, empty, and heading-complete truncated drafts once", async () => {
    for (const draft of [
      { text: validSummary + "x".repeat(16_001) },
      { text: "## Goal\nMissing sections" },
      { text: "" },
      { text: validSummary, stopReason: "length" as const },
    ]) {
      const { result, prompts } = await generate([
        draft,
        { text: validSummary },
      ]);
      assert.ok(result.ok);
      assert.equal(prompts.length, 2);
      assert.match(prompts[1], /Rewrite the entire checkpoint/);
    }
  });
  it("rejects a second invalid draft and does not quality-retry provider errors", async () => {
    const invalid = await generate([
      { text: "invalid" },
      { text: "still invalid" },
    ]);
    assert.equal(invalid.result.ok, false);
    assert.equal(invalid.prompts.length, 2);
    for (const stopReason of ["error", "aborted"] as const) {
      const failure = await generate([{ text: validSummary, stopReason }]);
      assert.equal(failure.result.ok, false);
      assert.equal(failure.prompts.length, 1);
    }
  });
  it("handles long heading whitespace and CRLF without consuming section content", () => {
    const whitespace = "\t".repeat(100_000);
    const padded = validSummary
      .replaceAll("\n", "\r\n")
      .replace("## Goal", `## Goal${whitespace}`);
    assert.deepEqual(summaryDefects(padded, Number.MAX_SAFE_INTEGER), []);
    assert.ok(
      summaryDefects(
        `## a${whitespace}\r\nbody`,
        Number.MAX_SAFE_INTEGER,
      ).includes("use each required heading exactly once, in order"),
    );
    const empty = padded.replace("Finish the feature.", "\t \r\n");
    assert.ok(
      summaryDefects(empty, Number.MAX_SAFE_INTEGER).includes(
        "empty section at position 1",
      ),
    );
  });

  it("rejects duplicate, empty, and out-of-order sections", () => {
    assert.equal(summaryDefects(validSummary, 4_000).length, 0);
    assert.ok(
      summaryDefects(validSummary + "\n## Goal\nDuplicate", 4_000).length,
    );
    assert.ok(
      summaryDefects(validSummary.replace("Finish the feature.", ""), 4_000)
        .length,
    );
    assert.ok(
      summaryDefects(
        validSummary.replace("## Goal", "## Critical References"),
        4_000,
      ).length,
    );
  });
  it("uses one request for split history with only a previous checkpoint and bounds file references", async () => {
    const registration = registerManagedFauxProvider({
      provider: `summary-test-${++sequence}`,
      models: [{ id: "summary", name: "Summary" }],
      tokensPerSecond: 100_000,
    });
    const prompts: string[] = [];
    registration.setResponses([
      async (context) => {
        prompts.push(JSON.stringify(context));
        return fauxAssistantMessage(validSummary);
      },
    ]);
    const fileOps = createFileOps();
    for (let i = 0; i < 1000; i++) fileOps.edited.add(`/src/feature-${i}.ts`);
    try {
      const result = await compact(
        {
          firstKeptEntryId: "kept",
          messagesToSummarize: [],
          turnPrefixMessages: [user("Current edit incomplete")],
          previousSummary: "Binding constraint: preserve API",
          isSplitTurn: true,
          tokensBefore: 100_000,
          fileOps,
          settings: {
            enabled: true,
            reserveTokens: 16_384,
            keepRecentTokens: 20_000,
          },
        },
        registration.getModel("summary"),
        "",
      );
      assert.ok(result.ok);
      assert.equal(prompts.length, 1);
      assert.match(prompts[0], /Binding constraint/);
      assert.equal(result.value.summary, validSummary);
      assert.equal(result.value.details?.modifiedFiles.length, 1000);
      assert.doesNotMatch(result.value.summary, /<modified-files>/);
    } finally {
      registration.unregister();
    }
  });
});
