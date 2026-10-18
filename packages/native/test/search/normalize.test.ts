import assert from "node:assert/strict";
import test from "node:test";
import { compactCandidate, compactField } from "../../src/search/normalize.js";

function candidate(path: string) {
  const segments = path.split("/");
  const name = segments.at(-1)!;
  return {
    relativePath: path,
    name,
    stem: name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name,
    segments,
    depth: segments.length,
    kind: "file" as const,
  };
}
test("canonical ASCII sends no duplicate text/components/casing", () => {
  assert.deepEqual(compactCandidate(candidate("src/FooBar.ts"), 4), {
    path: "src/FooBar.ts",
    directory: false,
    localeRank: 4,
    depth: 2,
  });
  assert.deepEqual(compactField({ key: "title", text: "Fix Hello" }), {
    key: "title",
    text: "Fix Hello",
  });
});
test("Unicode overrides preserve independent JS contextual stem casing", () => {
  assert.deepEqual(compactCandidate(candidate("ΟΣ.txt"), 0), {
    path: "ΟΣ.txt",
    directory: false,
    localeRank: 0,
    depth: 1,
    pathLower: "οσ.txt",
    stemLower: "ος",
  });
  assert.equal(compactCandidate(candidate("İx"), 0).pathLower, "i\u0307x");
  assert.equal(
    compactField({ key: "title", text: "\ud800 İΣ" }).lower,
    "\ud800 i\u0307ς",
  );
});
test("legacy noncanonical component data is transferred only as necessary overrides", () => {
  const c = {
    ...candidate("path/item.ts"),
    name: "Custom.ts",
    stem: "Different",
    segments: ["other", "Custom.ts"],
  };
  const compact = compactCandidate(c, 0);
  assert.deepEqual(compact.segments, c.segments);
  assert.equal(compact.name, undefined);
  assert.equal(compact.nameLower, undefined);
  assert.equal(compact.stem, "Different");
  assert.equal(compact.stemLower, "different");
  assert.deepEqual(compact.segmentsLower, ["other", "custom.ts"]);
});
