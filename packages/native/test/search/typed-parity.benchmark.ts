// Synthetic exact-output checkpoint, not a production fallback or second matcher.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  SearchDocument,
  SearchIndex,
  SearchResult,
  SearchUpdate,
} from "../../src/search/contracts.js";

const documents: SearchDocument[] = Array.from({ length: 300 }, (_, i) => ({
  id: `file:${String(i).padStart(3, "0")}`,
  kind: "file",
  fields: [{ key: "path", text: `src/Feature${i}.ts` }],
}));
for (const [id, text] of [
  ["dotted", "src/İ.ts"],
  ["literal", "src/i\u0307.ts"],
  ["greek", "ΟΣ.txt"],
  ["emoji", "😀/hello.ts"],
  ["lone", "x/\ud800.ts"],
  ["tie:z", "src/aa.ts"],
  ["tie:a", "src/AA.ts"],
  ["directory", "src/folder/"],
])
  documents.push({
    id: `file:${id}`,
    kind: "file",
    fields: [{ key: "path", text: text! }],
  });
documents.push(
  {
    id: "pr:271",
    kind: "pr",
    fields: [
      { key: "identifier", text: "271" },
      { key: "title", text: "fix memory leak" },
    ],
  },
  {
    id: "pr:partial",
    kind: "pr",
    fields: [{ key: "identifier", text: "271" }],
  },
  {
    id: "skill:partial",
    kind: "skill",
    fields: [{ key: "name", text: "fix" }],
  },
  {
    id: "multi:x",
    kind: "pr",
    fields: [
      { key: "identifier", text: "42" },
      { key: "title", text: "Composer fixes" },
      { key: "path", text: "branch/İ.ts" },
    ],
  },
  {
    id: "multi:unicode",
    kind: "skill",
    fields: [
      { key: "name", text: "İx" },
      { key: "title", text: "ΟΣ" },
      { key: "description", text: "😀FooBar \ud800" },
    ],
  },
  {
    id: "named",
    kind: "skill",
    fields: [
      { key: "name", text: "named" },
      { key: "description", text: "" },
    ],
  },
);
const changed: SearchUpdate = {
  remove: ["pr:partial", "file:005"],
  upsert: [
    {
      id: "file:010",
      kind: "file",
      fields: [{ key: "path", text: "src/Renamed.ts" }],
    },
    { id: "multi:x", kind: "pr", fields: [{ key: "title", text: "replaced" }] },
  ],
};
const factory = (await import(
  pathToFileURL(resolve(process.argv[2] ?? "src/index.ts")).href
)) as { createSearchIndex(): Promise<SearchIndex> };
const index = await factory.createSearchIndex();
const output: unknown[] = [];
try {
  output.push(await index.update({ upsert: documents, remove: [] }));
  for (const limit of [8, 64, 256]) {
    for (const text of [
      "",
      "Feature",
      "src/Fe",
      "İ",
      "İ.t",
      "ts",
      "src/İ.ts",
      "😀he",
      "ος",
      "ΟΣ",
      "\ud800",
      "271 fix",
      "271",
      "fix",
      "folder/",
      "src/f",
      "42 Composer",
      "named",
    ]) {
      for (const kinds of [undefined, [], ["file"], ["pr", "skill"]])
        output.push({
          text,
          limit,
          kinds,
          result: await index.query({ text, limit, kinds }),
        });
    }
  }
  output.push(await index.update(changed));
  for (const limit of [8, 64, 256])
    for (const text of ["Feature", "Renamed", "42 Composer", "271 fix"])
      output.push({ text, limit, result: await index.query({ text, limit }) });
  output.push(
    await index.update({ upsert: [], remove: ["missing", "missing"] }),
  );
} finally {
  await index.close();
}
// Normalize omitted properties exactly as the stored JSON checkpoint does.
const captured: unknown = JSON.parse(JSON.stringify(output));
if (process.argv[3] === "--capture-structural") {
  // Independent frozen matcher outputs, in <=128-document shards so no top-k item
  // can disappear before the intentionally changed tie comparator is applied.
  // Only ordering changes: every selected ID, numeric score and range remains exact.
  // Run this mode with the preserved pre-tie facade/addon in its own process.
  const baseline = factory;
  const expected: unknown[] = [];
  const live = new Map(documents.map((document) => [document.id, document]));
  let shards: SearchIndex[] = [];
  let phase = 0;
  const rebuild = async () => {
    for (const shard of shards) await shard.close();
    shards = [];
    const docs = [...live.values()];
    for (let i = 0; i < docs.length; i += 128) {
      const shard = await baseline.createSearchIndex();
      shards.push(shard);
      await shard.update({ upsert: docs.slice(i, i + 128), remove: [] });
    }
  };
  const pathLength = (id: string) =>
    Math.min(
      ...live
        .get(id)!
        .fields.filter((field) => field.key === "path")
        .map((field) => field.text.length),
    );
  try {
    for (const entry of output as (
      | { revision: number }
      | { text: string; limit: number; kinds?: string[]; result: SearchResult }
    )[]) {
      if ("revision" in entry) {
        assert.equal(entry.revision, [1, 2, 2][phase]);
        expected.push(entry);
        if (phase === 1) {
          for (const id of changed.remove) live.delete(id);
          for (const document of changed.upsert)
            live.set(document.id, document);
        }
        if (phase < 2) await rebuild();
        phase++;
        continue;
      }
      const items = (
        await Promise.all(
          shards.map((shard) =>
            shard.query({ text: entry.text, kinds: entry.kinds, limit: 256 }),
          ),
        )
      ).flatMap((result) => result.items);
      items.sort(
        (a, b) =>
          b.lexicalScore - a.lexicalScore ||
          (pathLength(a.id) < pathLength(b.id)
            ? -1
            : pathLength(a.id) > pathLength(b.id)
              ? 1
              : 0) ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
      expected.push({
        text: entry.text,
        limit: entry.limit,
        kinds: entry.kinds,
        result: { revision: phase, items: items.slice(0, entry.limit) },
      });
    }
  } finally {
    for (const shard of shards) await shard.close();
  }
  writeFileSync(process.argv[4]!, JSON.stringify(expected));
  console.log(
    "Captured 228-query structural-tie reference from frozen matcher shards; numeric scores/ranges unchanged, only the specified tie order applied.",
  );
} else if (process.argv[3] === "--compare") {
  assert.deepEqual(
    captured,
    JSON.parse(readFileSync(process.argv[4]!, "utf8")),
  );
  console.log(
    `Typed exact-output parity passed: 228 queries over ${documents.length} documents, limits 8/64/256, kinds and atomic revisions.`,
  );
} else {
  writeFileSync(
    process.argv[3] ?? "/tmp/nerve-search-typed-preopt-parity.json",
    JSON.stringify(captured),
  );
  console.log(
    `Captured 228 typed queries over ${documents.length} documents at limits 8/64/256.`,
  );
}
