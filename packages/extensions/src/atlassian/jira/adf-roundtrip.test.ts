import assert from "node:assert/strict";
import { test } from "node:test";
import { adfToMarkdown } from "./adf-markdown.js";
import { markdownToAdf } from "./markdown-adf.js";

void test("Markdown converts to ADF and back", () => {
  const markdown = [
    "## Plan",
    "",
    "Do **this** and `that` in [docs](https://x.test).",
    "",
    "- one",
    "  - nested",
    "- two",
    "",
    "1. first",
    "2. second",
    "",
    "```ts",
    "const a = 1;",
    "```",
  ].join("\n");
  const adf = markdownToAdf(markdown);
  assert.deepEqual(
    adf.content.map((node) => node.type),
    ["heading", "paragraph", "bulletList", "orderedList", "codeBlock"],
  );
  assert.equal(adfToMarkdown(adf), markdown);
});
