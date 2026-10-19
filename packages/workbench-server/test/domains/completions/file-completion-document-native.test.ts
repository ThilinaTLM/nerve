import assert from "node:assert/strict";
import { test } from "node:test";
import { createSearchIndex } from "@nervekit/native";
import { FileCompletionDocument } from "../../../src/domains/completions/file-completion-document.js";

void test("compact directory paths preserve folder ranking and UTF-16 display ranges", async () => {
  const documents = [
    new FileCompletionDocument("p", "src/session", "directory"),
    new FileCompletionDocument("p", "src/session.ts", "file"),
    new FileCompletionDocument("p", "src/session/inner", "directory"),
    new FileCompletionDocument("p", "src/session/inner.ts", "file"),
    new FileCompletionDocument("p", "docs/session", "directory"),
    new FileCompletionDocument("p", "src/会話", "directory"),
    new FileCompletionDocument("p", "src/会話.ts", "file"),
    new FileCompletionDocument("p", "src/🪴/garden.ts", "file"),
  ];
  const directory = documents[0]!;
  assert.equal(directory.fields[0]?.text, "src/session/");
  assert.equal(directory.item.info, "src/session");
  assert.equal(directory.item.label, "@src/session/");
  assert.deepEqual(directory.displayField, { index: 0, offset: 1 });
  assert.equal(directory.id, '["directory","src/session"]');
  assert.equal(directory.version, directory.id);

  // Independently declared order and native UTF-16 ranges; display adds the @ offset.
  const cases: { query: string; expected: [number, number[][]][] }[] = [
    {
      query: "session",
      expected: [
        [1, [[4, 11]]],
        [0, [[4, 11]]],
        [4, [[5, 12]]],
        [3, [[4, 11]]],
        [2, [[4, 11]]],
      ],
    },
    {
      query: "session/",
      expected: [
        [0, [[4, 11]]],
        [4, [[5, 12]]],
        [1, [[4, 11]]],
        [2, [[4, 11]]],
        [3, [[4, 11]]],
      ],
    },
    {
      query: "sess/",
      expected: [
        [0, [[4, 8]]],
        [4, [[5, 9]]],
        [1, [[4, 8]]],
        [2, [[4, 8]]],
        [3, [[4, 8]]],
      ],
    },
    // Folder intent lists descendants, not the exact parent itself.
    {
      query: "src/session/",
      expected: [
        [
          1,
          [
            [0, 3],
            [4, 11],
          ],
        ],
        [2, [[0, 12]]],
        [3, [[0, 12]]],
      ],
    },
    {
      query: "会話/",
      expected: [
        [5, [[4, 6]]],
        [6, [[4, 6]]],
      ],
    },
    { query: "🪴", expected: [[7, [[4, 6]]]] },
  ];
  const typed = await createSearchIndex();
  try {
    await typed.update({ upsert: documents, remove: [] });
    for (const { query, expected } of cases) {
      const current = await typed.query({ text: query, limit: 64 });
      assert.deepEqual(
        current.items.map((match) => ({
          id: match.id,
          ranges: match.matches
            .find((field) => field.fieldIndex === 0)
            ?.ranges.map(([from, to]) => [from + 1, to + 1]),
        })),
        expected.map(([index, ranges]) => ({
          id: documents[index]!.id,
          ranges: ranges.map(([from, to]) => [from! + 1, to! + 1]),
        })),
        query,
      );
    }
  } finally {
    await typed.close();
  }
});
