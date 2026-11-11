import assert from "node:assert/strict";
import { test } from "node:test";
import { adfToMarkdown } from "./adf-markdown.js";
import { markdownToAdf } from "./markdown-adf.js";

const text = (value: string, marks?: unknown[]) => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});
const p = (...content: unknown[]) => ({ type: "paragraph", content });
const doc = (...content: unknown[]) => ({ type: "doc", version: 1, content });

void test("special characters in text survive a round trip", () => {
  for (const value of [
    "2*3*4",
    "snake_case_name and _x_",
    "a [b](c) ~~d~~ <e>",
    "back\\slash \\* here",
    "# not a heading",
    "- not a list",
    "1. not a list",
    "> not a quote",
    "---",
  ]) {
    const adf = doc(p(text(value)));
    const markdown = adfToMarkdown(adf);
    assert.deepEqual(markdownToAdf(markdown), adf, `${value} -> ${markdown}`);
  }
});

void test("escaped text keeps marks and code spans stay literal", () => {
  const adf = doc(
    p(
      text("2*3", [{ type: "strong" }]),
      text(" and "),
      text("a*b`c", [{ type: "code" }]),
    ),
  );
  assert.deepEqual(markdownToAdf(adfToMarkdown(adf)), adf);
});

void test("code blocks use a fence longer than any backtick run inside", () => {
  const code = "before\n````\nnested\n````\nafter";
  const adf = doc({
    type: "codeBlock",
    attrs: { language: "md" },
    content: [text(code)],
  });
  const markdown = adfToMarkdown(adf);
  assert.ok(markdown.startsWith("`````md\n"));
  assert.deepEqual(markdownToAdf(markdown), adf);
});

void test("parses GFM tables, escaped pipes and line breaks in cells", () => {
  const cell = (type: string, ...paragraphs: unknown[]) => ({
    type,
    content: paragraphs,
  });
  const adf = doc({
    type: "table",
    content: [
      {
        type: "tableRow",
        content: [
          cell("tableHeader", p(text("Name"))),
          cell("tableHeader", p(text("Note"))),
        ],
      },
      {
        type: "tableRow",
        content: [
          cell("tableCell", p(text("a|b"))),
          cell("tableCell", p(text("one")), p(text("two *x*"))),
        ],
      },
    ],
  });
  const markdown = adfToMarkdown(adf);
  assert.deepEqual(markdownToAdf(markdown), adf);
  assert.deepEqual(markdownToAdf("| A |\n|---|\n| 1 |").content, [
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [cell("tableHeader", p(text("A")))],
        },
        { type: "tableRow", content: [cell("tableCell", p(text("1")))] },
      ],
    },
  ]);
});
