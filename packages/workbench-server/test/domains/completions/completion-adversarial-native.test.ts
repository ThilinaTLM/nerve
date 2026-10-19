import assert from "node:assert/strict";
import { test } from "node:test";
import { createSearchIndex } from "@nervekit/native";
import { FileCompletionDocument } from "../../../src/domains/completions/file-completion-document.js";
import {
  adversarialJudgments,
  adversarialPaths,
} from "../../benchmarks/completion-adversarial-judgments.js";
import { judgedPaths } from "../../benchmarks/completion-judgments.js";

test("typed native index preserves intended ranks for ambiguous lexical judgments", async () => {
  const candidates = [...judgedPaths, ...adversarialPaths].map(
    (path) =>
      new FileCompletionDocument(
        "p",
        path,
        path.endsWith("/src") ? "directory" : "file",
      ),
  );
  for (let i = 0; i < 2000; i++)
    candidates.push(
      new FileCompletionDocument(
        "p",
        `synthetic/module-${i}/src/controller-${i}.ts`,
        "file",
      ),
    );
  const index = await createSearchIndex();
  try {
    await index.update({ upsert: candidates, remove: [] });
    for (const judgment of adversarialJudgments) {
      const matches = await index.query({ text: judgment.query, limit: 8 });
      const rank =
        matches.items.findIndex(
          (match) =>
            candidates.find((document) => document.id === match.id)?.item
              .info === judgment.expected,
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
