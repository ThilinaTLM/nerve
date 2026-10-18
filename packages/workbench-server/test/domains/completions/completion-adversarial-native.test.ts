import assert from "node:assert/strict";
import { test } from "node:test";
import { createFileCompletionIndex } from "@nervekit/native";
import { candidateFromPath } from "../../../src/domains/completions/file-completion-candidates.js";
import {
  adversarialJudgments,
  adversarialPaths,
} from "../../benchmarks/completion-adversarial-judgments.js";
import { judgedPaths } from "../../benchmarks/completion-judgments.js";

test("native ambiguous lexical judgments do not regress from the measured baseline", async () => {
  const candidates = [...judgedPaths, ...adversarialPaths].map((path) =>
    candidateFromPath(path, path.endsWith("/src") ? "directory" : "file"),
  );
  for (let i = 0; i < 2000; i++)
    candidates.push(
      candidateFromPath(`synthetic/module-${i}/src/controller-${i}.ts`, "file"),
    );
  const index = await createFileCompletionIndex(candidates);
  try {
    for (const judgment of adversarialJudgments) {
      const matches = await index.query(judgment.query, { limit: 8 });
      const rank =
        matches.findIndex(
          (match) =>
            candidates[match.candidateIndex]?.relativePath ===
            judgment.expected,
        ) + 1;
      // The ambiguous bare-basename case currently ranks third. Permit an
      // improvement, not a worse answer or a newly missing intended result.
      const maximumRank = judgment.query === "session.ts" ? 3 : 1;
      assert.ok(
        rank > 0 && rank <= maximumRank,
        `${judgment.query}: wanted ${judgment.expected}, rank ${rank}, maximum ${maximumRank}`,
      );
    }
  } finally {
    await index.close();
  }
});
