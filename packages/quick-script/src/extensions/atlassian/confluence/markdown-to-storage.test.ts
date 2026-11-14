import assert from "node:assert/strict";
import { test } from "node:test";
import { markdownToStorage } from "./markdown-to-storage.js";
import { assertWellFormedStorage } from "./storage-xml.js";

function convert(markdown: string): string {
  const xml = markdownToStorage(markdown);
  assertWellFormedStorage(xml);
  return xml;
}

void test("renders headings, inline marks, links and escaping", () => {
  assert.equal(
    convert(
      "# T & <x>\n\nA **b** *i* `c<d>` ~~s~~ [l](https://x.test/?a=1&b=2)",
    ),
    '<h1>T &amp; &lt;x&gt;</h1><p>A <strong>b</strong> <em>i</em> <code>c&lt;d&gt;</code> <span style="text-decoration: line-through;">s</span> <a href="https://x.test/?a=1&amp;b=2">l</a></p>',
  );
});

void test("renders nested lists and task lists", () => {
  assert.equal(
    convert("- a\n  1. b\n  2. c\n- d"),
    "<ul><li><p>a</p><ol><li><p>b</p></li><li><p>c</p></li></ol></li><li><p>d</p></li></ul>",
  );
  const tasks = convert("- [ ] todo\n- [x] done");
  assert.match(
    tasks,
    /^<ac:task-list><ac:task><ac:task-id>1<\/ac:task-id><ac:task-status>incomplete<\/ac:task-status><ac:task-body>todo<\/ac:task-body><\/ac:task>/,
  );
  assert.match(
    tasks,
    /<ac:task-status>complete<\/ac:task-status><ac:task-body>done/,
  );
});

void test("renders GFM tables with a header row", () => {
  assert.equal(
    convert("| A | B |\n|---|:-:|\n| 1 | x \\| y |"),
    "<table><tbody><tr><th><p>A</p></th><th><p>B</p></th></tr><tr><td><p>1</p></td><td><p>x | y</p></td></tr></tbody></table>",
  );
});

void test("renders fenced code as a code macro and splits CDATA terminators", () => {
  const xml = convert("```ts\nconst a = '<b>]]>';\n```");
  assert.match(xml, /<ac:parameter ac:name="language">ts<\/ac:parameter>/);
  assert.ok(xml.includes("<![CDATA[const a = '<b>]]]]><![CDATA[>';]]>"));
});

void test("renders blockquote, rule and images by URL", () => {
  assert.equal(
    convert("> quote\n\n---\n\n![alt](https://x.test/i.png)"),
    '<blockquote><p>quote</p></blockquote><hr/><p><ac:image ac:alt="alt"><ri:url ri:value="https://x.test/i.png"/></ac:image></p>',
  );
});
