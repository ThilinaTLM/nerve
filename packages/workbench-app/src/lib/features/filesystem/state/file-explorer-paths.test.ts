import assert from "node:assert/strict";
import { test } from "node:test";
import {
  duplicateName,
  planDrop,
  renameSelectionEnd,
  retargetPath,
  topLevelPaths,
  validateEntryName,
} from "./file-explorer-paths";

test("retargets a path only at or below the moved entry", () => {
  assert.equal(retargetPath("src/a.ts", "src", "lib"), "lib/a.ts");
  assert.equal(retargetPath("src", "src", "lib/src"), "lib/src");
  assert.equal(retargetPath("src2/a.ts", "src", "lib"), "src2/a.ts");
});

test("rename selects the base name without the extension", () => {
  assert.equal(renameSelectionEnd("index.test.ts", false), 10);
  assert.equal(renameSelectionEnd(".gitignore", false), 10);
  assert.equal(renameSelectionEnd("v1.2", true), 4);
});

test("validates names against siblings", () => {
  const siblings = new Set(["a.ts"]);
  assert.match(validateEntryName("a.ts", siblings) ?? "", /already exists/);
  assert.equal(validateEntryName("a.ts", siblings, "a.ts"), undefined);
  assert.ok(validateEntryName("x/y", siblings));
  assert.ok(validateEntryName("  ", siblings));
});

test("picks the first free duplicate name", () => {
  assert.equal(duplicateName("a.ts", false, new Set(["a.ts"])), "a copy.ts");
  assert.equal(
    duplicateName("a.ts", false, new Set(["a copy.ts"])),
    "a copy 2.ts",
  );
  assert.equal(duplicateName("dir.d", true, new Set()), "dir.d copy");
});

test("plans drops and refuses folders into themselves", () => {
  const dir = { path: "src", kind: "directory" as const };
  assert.deepEqual(planDrop([dir], "src/inner", "move"), {
    ok: false,
    reason: "Cannot drop a folder into itself.",
  });
  assert.equal(planDrop([dir], "", "move").ok, false); // already in root
  assert.deepEqual(planDrop([dir], "lib", "move"), {
    ok: true,
    moves: [{ from: "src", to: "lib/src" }],
  });
  assert.equal(planDrop([dir], "", "copy").ok, true);
  const clash = planDrop(
    [
      { path: "a/x", kind: "file" },
      { path: "b/x", kind: "file" },
    ],
    "c",
    "move",
  );
  assert.equal(clash.ok, false);
});

test("drops nested paths from bulk operations", () => {
  assert.deepEqual(topLevelPaths(["a/b", "a", "c"]), ["a", "c"]);
});
