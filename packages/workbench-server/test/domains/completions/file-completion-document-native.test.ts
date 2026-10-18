import assert from "node:assert/strict";
import { test } from "node:test";
import { createFileCompletionIndex, createSearchIndex } from "@nervekit/native";
import { candidateFromPath } from "../../../src/domains/completions/file-completion-candidates.js";
import { FileCompletionDocument } from "../../../src/domains/completions/file-completion-document.js";

void test("compact directory path convention preserves legacy folder intent, scores and UTF-16 ranges", async () => {
  const documents = [
    new FileCompletionDocument("p", "src/session", "directory"),
    new FileCompletionDocument("p", "src/session.ts", "file"),
    new FileCompletionDocument("p", "src/session/inner", "directory"),
    new FileCompletionDocument("p", "src/session/inner.ts", "file"),
    new FileCompletionDocument("p", "docs/session", "directory"),
    new FileCompletionDocument("p", "src/会話", "directory"),
    new FileCompletionDocument("p", "src/会話.ts", "file"),
  ];
  const directory = documents[0]!;
  assert.equal(directory.fields[0]?.text, "src/session/");
  assert.equal(directory.item.info, "src/session");
  assert.equal(directory.item.label, "@src/session/");
  assert.deepEqual(directory.displayField, { index: 0, offset: 1 });
  assert.equal(directory.id, '["directory","src/session"]');
  assert.equal(directory.version, directory.id);
  const candidates = documents.map((document) =>
    candidateFromPath(document.item.info!, document.kind),
  );
  const legacy = await createFileCompletionIndex(candidates);
  const typed = await createSearchIndex();
  try {
    await typed.update({ upsert: documents, remove: [] });
    for (const query of [
      "session",
      "session/",
      "sess/",
      "src/session/",
      "会話/",
    ]) {
      const old = await legacy.query(query, { limit: 64 });
      const current = await typed.query({ text: query, limit: 64 });
      assert.ok(old.length > 0, query);
      const expected = old
        .map((match) => ({
          id: documents[match.candidateIndex]!.id,
          score: match.score,
          ranges: match.matchRanges,
        }))
        .sort((a, b) => a.id.localeCompare(b.id));
      const actual = current.items
        .map((match) => ({
          id: match.id,
          score: match.lexicalScore,
          ranges: match.matches
            .find((field) => field.fieldIndex === 0)
            ?.ranges.map(([from, to]) => [from + 1, to + 1]),
        }))
        .sort((a, b) => a.id.localeCompare(b.id));
      assert.deepEqual(actual, expected, query);
      if (query.endsWith("/"))
        assert.ok(
          current.items.some(
            (match) =>
              documents.find((document) => document.id === match.id)?.kind ===
              "directory",
          ),
          query,
        );
      if (query === "src/session/")
        assert.ok(
          current.items.every((match) => match.id !== directory.id),
          "folder intent lists descendants, not the exact parent itself",
        );
    }
  } finally {
    await Promise.all([legacy.close(), typed.close()]);
  }
});
