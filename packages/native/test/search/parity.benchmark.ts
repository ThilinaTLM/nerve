// Synthetic same-host behavioral capture/compare. Old engine is a temporary artifact,
// never a production fallback. See search.benchmark.md for reproduction.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  FileCompletionCandidateInput,
  FileCompletionIndex,
} from "../../src/search/index.js";

const paths = [
  "src/ComposerEditor.ts",
  "src/fooBar.ts",
  "fooBar/src.ts",
  "😀/hello",
  "a/😀FooBar.txt",
  "İx",
  "İstanbul/İΣ.ts",
  "ΟΣ.txt",
  "x/\ud800",
  "é/e\u0301",
  "e\u0301/é",
  "folder",
  "folder/deep",
  "folder/deep/item.ts",
];
const candidates: FileCompletionCandidateInput[] = Array.from(
  { length: 1200 },
  (_, i) => {
    const relativePath =
      i < paths.length
        ? paths[i]!
        : `packages/${i % 11}/src/ComposerItem${i}.ts`;
    const segments = relativePath.split("/");
    const name = segments.at(-1)!;
    const kind = i === 11 || i === 12 ? "directory" : "file";
    const stem =
      kind === "file" && name.includes(".")
        ? name.slice(0, name.lastIndexOf("."))
        : name;
    return { relativePath, segments, name, stem, kind, depth: segments.length };
  },
);
// Accepted legacy overrides must not be silently reinterpreted by compression.
candidates.push({
  relativePath: "path/item.ts",
  name: "Custom.ts",
  stem: "Different",
  segments: ["other", "Custom.ts"],
  depth: 8,
  kind: "file",
});
const queries = [
  "",
  "src",
  "Com",
  "ComposerEditor",
  "CE",
  "fooBar",
  "sr/fb",
  "fb sr",
  "s s",
  "hello",
  "😀b",
  "i",
  "İ",
  "ος",
  "ΟΣ",
  "\ud800",
  "folder/",
  "folder/de/it",
  "packages/3/Com",
  "@src",
  "..\\secret",
  "/absolute",
  "Different",
  "Custom",
  "other Custom",
];

const module = (await import(
  pathToFileURL(resolve(process.argv[2] ?? "src/index.ts")).href
)) as {
  createFileCompletionIndex(
    candidates: FileCompletionCandidateInput[],
  ): Promise<FileCompletionIndex>;
};
const index = await module.createFileCompletionIndex(candidates);
const output = [];
try {
  for (const query of queries)
    output.push({ query, matches: await index.query(query) });
} finally {
  await index.close();
}
if (process.argv[3] === "--compare") {
  assert.deepEqual(output, JSON.parse(readFileSync(process.argv[4]!, "utf8")));
  console.log(
    `Same-host parity passed: ${queries.length} queries over ${candidates.length} synthetic candidates.`,
  );
} else {
  writeFileSync(
    process.argv[3] ?? "/tmp/nerve-search-parity.json",
    JSON.stringify(output),
  );
  console.log(
    `Captured ${queries.length} queries over ${candidates.length} synthetic candidates.`,
  );
}
