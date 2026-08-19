import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseFrontmatter } from "../../../../src/harness/resources/skills/parser.js";

describe("parseFrontmatter", () => {
  it("normalizes line endings and parses YAML metadata", () => {
    const result = parseFrontmatter<{ name: string }>(
      "---\r\nname: example\r\n---\r\n\r\nPrompt body\r\n",
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.value.frontmatter, { name: "example" });
    assert.equal(result.value.body, "Prompt body");
  });

  it("returns normalized content when frontmatter is absent or unterminated", () => {
    assert.deepEqual(parseFrontmatter("plain\rtext"), {
      ok: true,
      value: { frontmatter: {}, body: "plain\ntext" },
    });
    assert.deepEqual(parseFrontmatter("---\nname: example\nbody"), {
      ok: true,
      value: { frontmatter: {}, body: "---\nname: example\nbody" },
    });
  });

  it("returns a parse error for malformed YAML", () => {
    const result = parseFrontmatter("---\nname: [\n---\nbody");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error.message, /YAML|parse|flow|unexpected/i);
  });
});
