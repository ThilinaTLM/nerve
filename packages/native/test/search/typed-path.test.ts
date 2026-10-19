import assert from "node:assert/strict";
import test from "node:test";
import { createSearchIndex } from "../../src/index.js";

test("typed paths preserve ranking and source UTF16 ranges", async () => {
  for (const [path, queries] of [
    [
      "src/fooBar.ts",
      [
        ["fooBar", 18178, [[4, 10]]],
        ["foo", 12126.375, [[4, 7]]],
        [
          "sr/fb",
          13309.375,
          [
            [0, 2],
            [4, 5],
            [7, 8],
          ],
        ],
        [
          "fb sr",
          13309.375,
          [
            [0, 2],
            [4, 5],
            [7, 8],
          ],
        ],
        ["src/f", 16047.35, [[0, 5]]],
      ],
    ],
    [
      "src/folder/",
      [
        ["folder", 18038, [[4, 10]]],
        ["src/f", 15907.5, [[0, 5]]],
        ["src/", 16367.5, [[0, 4]]],
        ["src/folder/", null, []],
      ],
    ],
    [
      "😀/hello.ts",
      [
        ["hello", 18178, [[3, 8]]],
        ["😀/he", 16047.45, [[0, 5]]],
        ["ts", 11316.625, [[9, 11]]],
      ],
    ],
    [
      "ΟΣ.txt",
      [
        ["ος", 18179, [[0, 2]]],
        ["ΟΣ", 18179, [[0, 2]]],
        ["txt", 11363.25, [[3, 6]]],
      ],
    ],
    [
      "x/\ud800.ts",
      [
        ["\ud800", 18178, [[2, 3]]],
        ["ts", 11357.25, [[4, 6]]],
      ],
    ],
  ] as const) {
    const index = await createSearchIndex();
    try {
      await index.update({
        upsert: [
          {
            id: "opaque",
            kind: "opaque",
            fields: [{ key: "path", text: path }],
          },
        ],
        remove: [],
      });
      for (const [text, score, ranges] of queries) {
        const result = (await index.query({ text })).items;
        assert.deepEqual(
          result,
          score === null
            ? []
            : [
                {
                  id: "opaque",
                  lexicalScore: score,
                  matches: [{ fieldIndex: 0, score, ranges }],
                },
              ],
          `${path} / ${text}`,
        );
      }
    } finally {
      await index.close();
    }
  }
});
test("typed path highlights map JS casing expansion to original UTF16, including expanded queries", async () => {
  const typed = await createSearchIndex();
  try {
    await typed.update({
      upsert: [
        {
          id: "opaque",
          kind: "opaque",
          fields: [{ key: "path", text: "src/İ.ts" }],
        },
      ],
      remove: [],
    });
    for (const [text, ranges] of [
      ["ts", [[6, 8]]],
      ["İ", [[4, 5]]],
      ["İ.t", [[4, 7]]],
      ["İ.ts", [[4, 8]]],
      ["src/İ.t", [[0, 7]]],
      ["src/İ.ts", [[0, 8]]],
    ] as const)
      assert.deepEqual(
        (await typed.query({ text })).items[0]!.matches[0]!.ranges,
        ranges,
        text,
      );
  } finally {
    await typed.close();
  }
});
test("typed ties use opaque UTF16 IDs and empty queries have neutral scores", async () => {
  const typed = await createSearchIndex();
  try {
    await typed.update({
      upsert: ["src/aa.ts", "src/AA.ts"].map((text, i) => ({
        id: i === 0 ? "z" : "a",
        kind: "opaque",
        fields: [{ key: "path" as const, text }],
      })),
      remove: [],
    });
    for (const text of ["ts", ""]) {
      const result = await typed.query({ text });
      assert.deepEqual(
        result.items.map((item) => item.id),
        ["a", "z"],
      );
      assert.equal(
        result.items[0]!.lexicalScore,
        result.items[1]!.lexicalScore,
      );
      if (!text)
        assert.ok(result.items.every((item) => item.lexicalScore === 0));
    }
  } finally {
    await typed.close();
  }
});
test("length-expanding query maps correctly even when the stored path itself does not expand", async () => {
  const typed = await createSearchIndex();
  try {
    await typed.update({
      upsert: [
        {
          id: "file:literal-combining",
          kind: "opaque",
          fields: [{ key: "path", text: "src/i\u0307.ts" }],
        },
      ],
      remove: [],
    });
    for (const [text, ranges] of [
      ["İ", [[4, 6]]],
      ["İ.t", [[4, 8]]],
      ["src/İ.t", [[0, 8]]],
    ] as const)
      assert.deepEqual(
        (await typed.query({ text })).items[0]!.matches[0]!.ranges,
        ranges,
        text,
      );
  } finally {
    await typed.close();
  }
});

test("typed exact-basename ties prefer path brevity before opaque IDs", async () => {
  const paths = [
    "long-directory/Composer.ts",
    "q/Composer.ts",
    "p/Composer.ts",
  ];
  const typed = await createSearchIndex();
  try {
    await typed.update({
      upsert: paths.map((text, i) => ({
        id: ["a:long", "z:short", "b:short"][i]!,
        kind: "file",
        fields: [{ key: "path" as const, text }],
      })),
      remove: [],
    });
    const result = await typed.query({ text: "Composer.ts" });
    assert.deepEqual(
      result.items.map((item) => item.id),
      ["b:short", "z:short", "a:long"],
    );
    assert.ok(result.items.every((item) => item.lexicalScore === 18178));
    for (const item of result.items) {
      const source = paths[["a:long", "z:short", "b:short"].indexOf(item.id)]!;
      assert.deepEqual(item.matches[0]!.ranges, [
        [source.lastIndexOf("/") + 1, source.length],
      ]);
    }
  } finally {
    await typed.close();
  }
});
