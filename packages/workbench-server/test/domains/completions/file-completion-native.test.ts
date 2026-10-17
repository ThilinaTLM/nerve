import assert from "node:assert/strict";
import { it } from "node:test";
import { createFileCompletionIndex } from "@nervekit/native";
import { candidateFromPath } from "../../../src/domains/completions/file-completion-candidates.js";
import { toCompletionItem } from "../../../src/domains/completions/file-completion-items.js";
import { completeFileCandidates as optimized } from "../../benchmarks/file-completion-optimized.js";
import { variedCompletionCandidates } from "../../benchmarks/file-completion-workload.benchmark.js";

it("native ranker matches optimized TS for deterministic generated and Unicode edge queries", async () => {
  const candidates = [
    ...variedCompletionCandidates(300),
    ...[
      "src/İndex.ts",
      "İ/İstanbul.ts",
      "src/i\u0307ndex.ts",
      "😀/😀ComposerEditor.ts",
      "src/\ud800Name.ts",
      "src/\udc00Name.ts",
      "src/\ud83dX\ude00.ts",
      "e\u0301\u0323.ts",
      "e\u0323\u0301.ts",
      "foo/foo/item.ts",
      "foo/item.ts",
      "one two three four five six seven.ts",
      "one/two/three/four/five/six/seven.ts",
      `long/${"a".repeat(511)}Z.ts`,
      `long/${"a".repeat(512)}Z.ts`,
      "emoji/😀x.ts",
      "emoji/\ud83dX\ude00x.ts",
      "résumé/école.ts",
    ].map((path) => candidateFromPath(path, "file")),
    candidateFromPath("src", "directory"),
    candidateFromPath("src/İ", "directory"),
    ...Array.from({ length: 12 }, (_, index) => ({
      ...candidateFromPath(
        index % 2 ? "e\u0301\u0323.ts" : "e\u0323\u0301.ts",
        "file",
      ),
      parentPath: `duplicate-${index}`,
    })),
  ];
  const queries = new Set([
    "",
    "@",
    " @@@src ",
    "src/",
    "src//İ",
    "src\\İ",
    "İ",
    "i",
    "i\u0307",
    "İN",
    "istanbul",
    "😀",
    "😀x",
    "\ud83d",
    "\ude00",
    "\ud800",
    "\udc00",
    "😀CE",
    "aZ",
    "foo foo",
    "foo/foo",
    "foo foo foo",
    "one two three four five six seven",
    "one two three four five six seven.ts",
    "one/two/three/four/five/six/seven.ts",
    "one/two/three/four/five/six/se",
    "one two three four five six eight",
    "é",
    "e\u0301\u0323",
    "résumé école",
    "école résumé",
    "../private",
    "@..\\private",
    "/root",
    "C:/root",
    "//host/share",
  ]);
  // Fixed order and stride keep failures reproducible without property-test RNG.
  for (let index = 0; index < candidates.length; index += 3) {
    const candidate = candidates[index]!;
    for (const query of [
      candidate.relativePath,
      candidate.name,
      candidate.stem.toUpperCase(),
      candidate.name.slice(0, 3),
      candidate.segments[0] + "/" + candidate.stem,
      candidate.stem + " " + candidate.segments[0],
      candidate.stem.slice(0, 1) + candidate.stem.slice(-1),
    ])
      queries.add(query);
  }
  const index = await createFileCompletionIndex(candidates);
  try {
    for (const query of queries)
      for (const limit of [0, 1, 8]) {
        const matches = await index.query(query, { limit });
        const items = matches.map((match) =>
          toCompletionItem({
            candidate: candidates[match.candidateIndex]!,
            score: match.score,
            matchRanges: match.matchRanges,
          }),
        );
        assert.deepEqual(
          items,
          optimized(candidates, query, { limit }),
          `${JSON.stringify(query)}, limit=${limit}`,
        );
      }
  } finally {
    await index.close();
  }
});
