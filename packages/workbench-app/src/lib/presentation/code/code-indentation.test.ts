import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectIndentation } from "./code-indentation";

describe("indentation detection", () => {
  it("detects space widths from indentation steps", () => {
    assert.equal(
      detectIndentation("a {\n  b {\n    c;\n  }\n}\n").label,
      "Spaces: 2",
    );
    assert.equal(
      detectIndentation("def a():\n    if b:\n        c()\n    d()\n").label,
      "Spaces: 4",
    );
  });

  it("prefers tabs when tab-indented lines dominate", () => {
    const result = detectIndentation(
      "func a() {\n\tb()\n\tif c {\n\t\td()\n\t}\n}",
    );
    assert.equal(result.unit, "\t");
    assert.equal(result.label, "Tabs");
  });

  it("ignores block-comment continuation lines", () => {
    const text = [
      "/**",
      " * Doc comment",
      " * more",
      " */",
      "function a() {",
      "    return 1;",
      "}",
      "/**",
      " * again",
      " */",
    ].join("\n");
    assert.equal(detectIndentation(text).label, "Spaces: 4");
  });

  it("falls back to two spaces without indented lines", () => {
    assert.deepEqual(detectIndentation("a\nb\n"), {
      unit: "  ",
      tabSize: 4,
      label: "Spaces: 2",
    });
  });
});
