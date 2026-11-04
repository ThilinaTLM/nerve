import assert from "node:assert/strict";
import test from "node:test";
import {
  parseQuickOpenQuery,
  quickOpenPathParts,
  recentQuickOpenPaths,
} from "./quick-open-query";

test("parses a trailing line suffix", () => {
  assert.deepEqual(parseQuickOpenQuery("src/app.ts:42"), {
    query: "src/app.ts",
    line: 42,
  });
  assert.deepEqual(parseQuickOpenQuery("app:7:3"), { query: "app", line: 7 });
  assert.deepEqual(parseQuickOpenQuery("app:"), { query: "app" });
  assert.deepEqual(parseQuickOpenQuery("app:0"), { query: "app:0" });
  assert.deepEqual(parseQuickOpenQuery(" plain "), { query: "plain" });
});

test("splits path into directory and name highlights", () => {
  const parts = quickOpenPathParts("src/lib/app.ts", [0, 8, 9]);
  assert.equal(parts.directory, "src/lib/");
  assert.equal(parts.name, "app.ts");
  assert.deepEqual(parts.directorySegments[0], { text: "s", match: true });
  assert.deepEqual(parts.nameSegments, [
    { text: "ap", match: true },
    { text: "p.ts", match: false },
  ]);
});

test("recent paths are newest first with the active file leading", () => {
  assert.deepEqual(recentQuickOpenPaths(["a", "b", "c", "b"], "a"), [
    "a",
    "b",
    "c",
  ]);
  assert.deepEqual(recentQuickOpenPaths(["a", "b", "c"]), ["c", "b", "a"]);
});
