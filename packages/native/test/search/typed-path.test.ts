import assert from "node:assert/strict";
import test from "node:test";
import {
  createFileCompletionIndex,
  createSearchIndex,
  type FileCompletionCandidateInput,
} from "../../src/index.js";

function candidate(
  path: string,
  kind: "file" | "directory" = "file",
): FileCompletionCandidateInput {
  const segments = path.split("/"),
    name = segments.at(-1)!;
  return {
    relativePath: path,
    segments,
    name,
    stem:
      kind === "file" && name.includes(".")
        ? name.slice(0, name.lastIndexOf("."))
        : name,
    kind,
    depth: segments.length,
  };
}
test("ordinary typed file/directory/Unicode paths share legacy scores and matching", async () => {
  for (const [path, kind, queries] of [
    ["src/fooBar.ts", "file", ["fooBar", "foo", "sr/fb", "fb sr", "src/f"]],
    ["src/folder", "directory", ["folder", "src/f", "src/", "src/folder/"]],
    ["😀/hello.ts", "file", ["hello", "😀/he", "ts"]],
    ["ΟΣ.txt", "file", ["ος", "ΟΣ", "txt"]],
    ["x/\ud800.ts", "file", ["\ud800", "ts"]],
  ] as const) {
    const file = await createFileCompletionIndex([candidate(path, kind)]),
      typed = await createSearchIndex();
    try {
      await typed.update({
        upsert: [
          {
            id: "file:opaque",
            kind: "opaque",
            fields: [
              { key: "path", text: path + (kind === "directory" ? "/" : "") },
            ],
          },
        ],
        remove: [],
      });
      for (const text of queries) {
        const legacy = await file.query(text),
          result = (await typed.query({ text })).items;
        assert.equal(result.length, legacy.length, `${path} / ${text}`);
        if (!legacy.length) continue;
        assert.equal(
          result[0]!.lexicalScore,
          legacy[0]!.score,
          `${path} / ${text}`,
        );
        assert.deepEqual(
          result[0]!.matches[0]!.ranges,
          legacy[0]!.matchRanges.map(([start, end]) => [start - 1, end - 1]),
          `${path} / ${text}`,
        );
      }
    } finally {
      await file.close();
      await typed.close();
    }
  }
});
test("typed path highlights map JS casing expansion to original UTF16, including expanded queries", async () => {
  const file = await createFileCompletionIndex([candidate("src/İ.ts")]),
    typed = await createSearchIndex();
  try {
    await typed.update({
      upsert: [
        {
          id: "file:opaque",
          kind: "opaque",
          fields: [{ key: "path", text: "src/İ.ts" }],
        },
      ],
      remove: [],
    });
    const legacy = (await file.query("ts"))[0]!;
    assert.deepEqual(
      legacy.matchRanges,
      [[8, 10]],
      "legacy coordinate quirk intentionally stays unchanged",
    );
    for (const [text, ranges] of [
      ["ts", [[6, 8]]],
      ["İ", [[4, 5]]],
      ["İ.t", [[4, 7]]],
      ["İ.ts", [[4, 8]]],
      ["src/İ.t", [[0, 7]]],
      ["src/İ.ts", [[0, 8]]],
    ] as const) {
      const result = (await typed.query({ text })).items[0]!;
      assert.deepEqual(result.matches[0]!.ranges, ranges, text);
      assert.equal(
        result.lexicalScore,
        (await file.query(text))[0]!.score,
        text,
      );
    }
  } finally {
    await file.close();
    await typed.close();
  }
});
test("typed ties use opaque UTF16 IDs rather than legacy host-locale/input ordering", async () => {
  const candidates = [candidate("src/aa.ts"), candidate("src/AA.ts")];
  const file = await createFileCompletionIndex(candidates),
    typed = await createSearchIndex();
  try {
    const legacy = await file.query("ts");
    assert.equal(legacy[0]!.score, legacy[1]!.score);
    await typed.update({
      upsert: candidates.map((c, i) => ({
        id: i === legacy[0]!.candidateIndex ? "z" : "a",
        kind: "opaque",
        fields: [{ key: "path" as const, text: c.relativePath }],
      })),
      remove: [],
    });
    assert.deepEqual(
      (await typed.query({ text: "ts" })).items.map((item) => item.id),
      ["a", "z"],
    );
    const empty = await typed.query({ text: "" });
    assert.deepEqual(
      empty.items.map((item) => item.id),
      ["a", "z"],
    );
    assert.ok(
      empty.items.every((item) => item.lexicalScore === 0),
      "typed empty query is neutral, not file listing policy",
    );
  } finally {
    await file.close();
    await typed.close();
  }
});
test("noncanonical name/stem/depth metadata belongs only to the legacy adapter", async () => {
  const source = {
    ...candidate("real/file.ts"),
    name: "Custom.ts",
    stem: "Different",
    depth: 8,
  };
  const file = await createFileCompletionIndex([source]),
    typed = await createSearchIndex();
  try {
    const field = {
      key: "path" as const,
      text: source.relativePath,
      stem: source.stem,
      name: source.name,
      depth: source.depth,
    };
    await typed.update({
      upsert: [{ id: "file:opaque", kind: "opaque", fields: [field] }],
      remove: [],
    });
    assert.equal((await file.query("Different")).length, 1);
    assert.deepEqual((await typed.query({ text: "Different" })).items, []);
    assert.equal((await typed.query({ text: "file" })).items.length, 1);
  } finally {
    await file.close();
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

test("typed exact-basename ties prefer path brevity before opaque IDs without changing scores or legacy order", async () => {
  const candidates = [
    candidate("long-directory/Composer.ts"),
    candidate("q/Composer.ts"),
    candidate("p/Composer.ts"),
  ];
  const file = await createFileCompletionIndex(candidates),
    typed = await createSearchIndex();
  try {
    const before = await file.query("Composer.ts");
    await typed.update({
      upsert: candidates.map((c, i) => ({
        id: ["a:long", "z:short", "b:short"][i]!,
        kind: "file",
        fields: [{ key: "path", text: c.relativePath }],
      })),
      remove: [],
    });
    const result = await typed.query({ text: "Composer.ts" });
    assert.deepEqual(
      result.items.map((item) => item.id),
      ["b:short", "z:short", "a:long"],
    );
    assert.ok(
      result.items.every((item) => item.lexicalScore === before[0]!.score),
    );
    assert.deepEqual(await file.query("Composer.ts"), before);
    for (const item of result.items) {
      const source =
        candidates[["a:long", "z:short", "b:short"].indexOf(item.id)]!
          .relativePath;
      assert.deepEqual(item.matches[0]!.ranges, [
        [source.lastIndexOf("/") + 1, source.length],
      ]);
    }
  } finally {
    await file.close();
    await typed.close();
  }
});
