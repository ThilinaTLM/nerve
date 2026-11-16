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

void test("checkbox items become ADF tasks and return as checkboxes", () => {
  const markdown = [
    "- [ ] todo **now**",
    "  - [x] sub",
    "- [x] done",
    "",
    "- plain",
  ].join("\n");
  const adf = markdownToAdf(markdown);
  assert.deepEqual(
    adf.content.map((node) => node.type),
    ["taskList", "bulletList"],
  );
  const [first, nested, last] = adf.content[0].content as Array<{
    type: string;
    attrs?: { state?: string };
  }>;
  assert.equal(first.attrs?.state, "TODO");
  assert.equal(nested.type, "taskList");
  assert.equal(last.attrs?.state, "DONE");
  assert.equal(adfToMarkdown(adf), markdown);
});
