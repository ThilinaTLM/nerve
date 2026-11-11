import assert from "node:assert/strict";
import { test } from "node:test";
import { adfToMarkdown } from "./adf-markdown.js";

const text = (value: string, marks?: unknown[]) => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});
const p = (...content: unknown[]) => ({ type: "paragraph", content });
void test("renders blocks, marks and nested lists", () => {
  const doc = {
    type: "doc",
    version: 1,
    content: [
      { type: "heading", attrs: { level: 2 }, content: [text("Title")] },
      p(
        text("a "),
        text("bold", [{ type: "strong" }]),
        text(" "),
        text("link", [{ type: "link", attrs: { href: "https://x.test" } }]),
        text(" "),
        text("code", [{ type: "code" }]),
        { type: "mention", attrs: { id: "1", text: "@Ann" } },
      ),
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              p(text("one")),
              {
                type: "orderedList",
                content: [{ type: "listItem", content: [p(text("nested"))] }],
              },
            ],
          },
          { type: "listItem", content: [p(text("two"))] },
        ],
      },
      {
        type: "codeBlock",
        attrs: { language: "ts" },
        content: [text("let x = 1;")],
      },
      { type: "panel", content: [p(text("note"))] },
      { type: "rule" },
    ],
  };
  assert.equal(
    adfToMarkdown(doc),
    [
      "## Title",
      "",
      "a **bold** [link](https://x.test) `code`@Ann",
      "",
      "- one",
      "  1. nested",
      "- two",
      "",
      "```ts",
      "let x = 1;",
      "```",
      "",
      "> note",
      "",
      "---",
    ].join("\n"),
  );
});
void test("renders tables as GFM and unknown nodes as their text", () => {
  const cell = (type: string, value: string) => ({
    type,
    content: [p(text(value))],
  });
  const doc = {
    type: "doc",
    content: [
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [cell("tableHeader", "A"), cell("tableHeader", "B")],
          },
          {
            type: "tableRow",
            content: [cell("tableCell", "1"), cell("tableCell", "2")],
          },
        ],
      },
      { type: "mysteryBlock", content: [p(text("kept"))] },
    ],
  };
  assert.equal(
    adfToMarkdown(doc),
    "| A | B |\n| --- | --- |\n| 1 | 2 |\n\nkept",
  );
  assert.equal(adfToMarkdown(null), "");
});
void test("table cells keep backslashes before pipes and still escape the pipe", () => {
  const row = (value: string) => ({
    type: "tableRow",
    content: [{ type: "tableCell", content: [p(text(value))] }],
  });
  const doc = {
    type: "doc",
    content: [{ type: "table", content: [row("h"), row("a|b"), row("c\\|d")] }],
  };
  // `c\|d` is escaped as text (`c\\|d`), then the pipe rule doubles that again.
  assert.equal(
    adfToMarkdown(doc),
    "| h |\n| --- |\n| a\\|b |\n| c\\\\\\\\\\|d |",
  );
});
