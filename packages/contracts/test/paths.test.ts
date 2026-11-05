import assert from "node:assert/strict";
import test from "node:test";
import { parseProjectRelativePath } from "../src/paths/index.js";

type Opts = Parameters<typeof parseProjectRelativePath>[1];
const cases: [string, string, Opts, string | { reason: string }][] = [
  ["plain", "a/b", undefined, "a/b"],
  ["backslash", "a\\b", undefined, "a/b"],
  ["empty", "", undefined, { reason: "empty" }],
  ["empty allowed", "", { allowEmpty: true }, ""],
  ["dot rejected", ".", undefined, { reason: "dot_segment" }],
  ["mid dot rejected", "a/./b", undefined, { reason: "dot_segment" }],
  ["dot dropped", "./a/./b", { allowDot: true }, "a/b"],
  ["only dot dropped", ".", { allowDot: true }, { reason: "empty" }],
  ["only dot as root", ".", { allowDot: true, allowEmpty: true }, ""],
  ["parent", "a/../b", { allowDot: true }, { reason: "parent_segment" }],
  ["empty segment", "a//b", undefined, { reason: "empty_segment" }],
  ["trailing slash rejected", "a/", undefined, { reason: "empty_segment" }],
  ["trailing slash trimmed", "a//", { trimTrailingSlash: true }, "a"],
  ["absolute", "/a", undefined, { reason: "absolute" }],
  ["unc", "\\\\host\\x", undefined, { reason: "absolute" }],
  ["drive", "C:/x", undefined, { reason: "drive" }],
  ["drive backslash", "c:\\x", undefined, { reason: "drive" }],
  ["nul", "a\0b", undefined, { reason: "nul" }],
];

for (const [name, input, options, expected] of cases) {
  test(`parseProjectRelativePath: ${name}`, () => {
    const result = parseProjectRelativePath(input, options);
    if (typeof expected === "string") {
      assert.deepEqual(result.ok && result.path, expected);
      assert.deepEqual(
        result.ok && result.segments,
        expected ? expected.split("/") : [],
      );
    } else {
      assert.deepEqual(result, { ok: false, reason: expected.reason });
    }
  });
}
