import assert from "node:assert/strict";
import { test } from "node:test";
import { lintStoragePage } from "./page-lint.js";
import { assertWellFormedStorage, StorageXmlError } from "./storage-xml.js";

const lint = (
  storage: string,
  options: Partial<Parameters<typeof lintStoragePage>[1]> = {},
) => lintStoragePage(storage, { title: "Release plan", ...options });

const TOC =
  '<ac:structured-macro ac:name="toc" ac:schema-version="1"><ac:parameter ac:name="maxLevel">2</ac:parameter></ac:structured-macro>';
const panel = (name: string, title?: string) =>
  `<ac:structured-macro ac:name="${name}" ac:schema-version="1">${title ? `<ac:parameter ac:name="title">${title}</ac:parameter>` : ""}<ac:rich-text-body><p>x</p></ac:rich-text-body></ac:structured-macro>`;

void test("leaves a clean page untouched", () => {
  const xml =
    "<h1>Intro</h1><p>Hello &amp; welcome&nbsp;all</p><h2>Detail</h2><p>More</p>";
  const result = lint(xml);
  assert.equal(result.storage, xml);
  assert.deepEqual(result.fixes, []);
  assert.deepEqual(result.warnings, []);
});

void test("rejects malformed XML with line and element detail", () => {
  assert.throws(
    () => lint("<h1>Intro</h1>\n<p>text</div>"),
    (error) => {
      assert.ok(error instanceof StorageXmlError);
      assert.match(
        error.message,
        /Closing tag <\/div> at line 2 does not match <p> opened at line 2/,
      );
      return true;
    },
  );
  assert.throws(() => lint("<p>a & b</p>"), /Bare '&'.*line 1/);
  assert.throws(() => lint("<p class=x>a</p>"), /must be quoted/);
  assert.throws(() => lint("<p>open"), /<p> opened at line 1 is never closed/);
  assert.doesNotThrow(() =>
    assertWellFormedStorage("<p><![CDATA[a < b & ]]></p><br/>"),
  );
});

void test("promotes headings so the top level is H1 and removes a title-equal leading H1", () => {
  const promoted = lint("<h2>One</h2><h3>Sub</h3><h2>Two</h2>");
  assert.equal(promoted.storage, "<h1>One</h1><h2>Sub</h2><h1>Two</h1>");
  assert.equal(promoted.fixes.length, 1);

  const titled = lint(
    "<h1>Release Plan</h1><h2>One</h2><p>x</p><h2>Two</h2><p>y</p>",
  );
  assert.equal(titled.storage, "<h1>One</h1><p>x</p><h1>Two</h1><p>y</p>");
  assert.equal(titled.fixes.length, 2);

  const other = lint("<h1>Something else</h1><p>x</p>");
  assert.equal(other.storage, "<h1>Something else</h1><p>x</p>");
});

void test("warns about skipped heading levels and headings inside macros are left alone", () => {
  const result = lint("<h1>A</h1><p>x</p><h3>B</h3><p>y</p>");
  assert.match(result.warnings.join("\n"), /"B" jumps from H1 to H3/);
  const inMacro = lint(
    `<h1>A</h1><p>x</p><ac:structured-macro ac:name="expand"><ac:rich-text-body><h4>deep</h4><p>z</p></ac:rich-text-body></ac:structured-macro>`,
  );
  assert.ok(inMacro.storage.includes("<h4>deep</h4>"));
});

void test("inserts a TOC after a leading panel (or at the top) for long pages and honors toc: false", () => {
  const sections = "<h1>A</h1><p>a</p><h1>B</h1><p>b</p><h1>C</h1><p>c</p>";
  const top = lint(sections);
  assert.equal(top.storage, TOC + sections);
  const afterPanel = lint(panel("info") + sections);
  assert.equal(afterPanel.storage, panel("info") + TOC + sections);
  assert.equal(lint(sections, { toc: false }).storage, sections);
  assert.equal(lint(TOC + sections).fixes.length, 0);
  const longText = `<h1>A</h1><p>${"word ".repeat(650)}</p>`;
  assert.ok(
    lint(longText).storage.startsWith('<ac:structured-macro ac:name="toc"'),
  );
  assert.equal(
    lint("<h1>A</h1><p>short</p><h1>B</h1><p>x</p>").fixes.length,
    0,
  );
});

void test("computes proportional table widths summing to the content width", () => {
  const table =
    "<table><tbody><tr><th><p>Key</p></th><th><p>Type</p></th><th><p>Summary</p></th></tr>" +
    "<tr><td><p>APP-1</p></td><td><p>Bug</p></td><td><p>A fairly long summary describing what is going on here in detail</p></td></tr></tbody></table>";
  const result = lint(table);
  const widths = [...result.storage.matchAll(/width: (\d+)px/g)].map((m) =>
    Number(m[1]),
  );
  assert.equal(widths.length, 3);
  assert.equal(
    widths.reduce((a, b) => a + b, 0),
    760,
  );
  assert.ok(
    widths[2] > widths[0] * 3,
    `summary column should be much wider: ${widths}`,
  );
  assert.match(result.storage, /^<table data-layout="default"><colgroup>/);
  assert.equal(result.fixes.length, 1);
});

void test("table widths respect data-layout, layout cells, short macros, and replace width-less colgroups", () => {
  const wide = lint(
    '<table data-layout="wide"><tbody><tr><th><p>A</p></th><th><p>B</p></th></tr></tbody></table>',
  );
  const widths = [...wide.storage.matchAll(/width: (\d+)px/g)].map((m) =>
    Number(m[1]),
  );
  assert.equal(
    widths.reduce((a, b) => a + b, 0),
    960,
  );

  const inCell = lint(
    '<ac:layout><ac:layout-section ac:type="two_equal"><ac:layout-cell><table><tbody><tr><th><p>A</p></th><th><p>B</p></th></tr></tbody></table></ac:layout-cell><ac:layout-cell><p>x</p></ac:layout-cell></ac:layout-section></ac:layout>',
  );
  const cellWidths = [...inCell.storage.matchAll(/width: (\d+)px/g)].map((m) =>
    Number(m[1]),
  );
  assert.equal(
    cellWidths.reduce((a, b) => a + b, 0),
    380,
  );

  const status =
    '<ac:structured-macro ac:name="status"><ac:parameter ac:name="title">In progress with a very long label</ac:parameter></ac:structured-macro>';
  const lozenge = lint(
    `<table><tbody><tr><th><p>Status</p></th><th><p>Notes</p></th></tr><tr><td>${status}</td><td><p>${"note ".repeat(12)}</p></td></tr></tbody></table>`,
  );
  const lw = [...lozenge.storage.matchAll(/width: (\d+)px/g)].map((m) =>
    Number(m[1]),
  );
  assert.ok(lw[0] < lw[1]);

  const empty = lint(
    "<table><colgroup><col/><col/></colgroup><tbody><tr><th><p>A</p></th><th><p>B</p></th></tr></tbody></table>",
  );
  assert.equal([...empty.storage.matchAll(/<col /g)].length, 2);
  assert.match(empty.storage, /width: \d+px/);
});

void test("never overrides explicit table widths", () => {
  const explicit =
    '<table data-layout="default"><colgroup><col style="width: 100px;"/><col style="width: 500px;"/></colgroup><tbody><tr><th><p>A</p></th><th><p>B</p></th></tr></tbody></table>';
  const result = lint(explicit);
  assert.equal(result.storage, explicit);
  assert.deepEqual(result.fixes, []);
});

void test("sets and clamps image widths and flags unsupported or unsized images", () => {
  const image = (name: string, attrs = "") =>
    `<ac:image${attrs}><ri:attachment ri:filename="${name}"/></ac:image>`;
  const sized = lint(image("a.png"), {
    images: new Map([["a.png", { width: 400, height: 300 }]]),
  });
  assert.equal(sized.storage, image("a.png", ' ac:width="400"'));
  const big = lint(image("b.png"), {
    images: { "b.png": { width: 2000, height: 900 } },
  });
  assert.equal(big.storage, image("b.png", ' ac:width="760"'));
  const clamped = lint(image("c.png", ' ac:width="1200" ac:height="500"'));
  assert.equal(clamped.storage, image("c.png", ' ac:width="760"'));
  const explicit = lint(image("d.png", ' ac:width="300"'));
  assert.equal(explicit.storage, image("d.png", ' ac:width="300"'));
  const unknown = lint(image("e.webp"));
  assert.match(unknown.warnings.join("\n"), /WEBP.*PNG or JPEG/);
  assert.match(unknown.warnings.join("\n"), /"e\.webp" has no width/);
  const inCell = lint(
    `<ac:layout><ac:layout-section ac:type="two_equal"><ac:layout-cell>${image("f.png")}</ac:layout-cell><ac:layout-cell><p>x</p></ac:layout-cell></ac:layout-section></ac:layout>`,
    {
      images: { "f.png": { width: 700, height: 100 } },
    },
  );
  assert.match(inCell.storage, /ac:width="380"/);
});

void test("warns about redundant headings, panels and empty sections", () => {
  const result = lint(
    `<h1>Overview</h1>${panel("info", "Overview")}` +
      `<h1>APP-1</h1><ac:structured-macro ac:name="jira"><ac:parameter ac:name="key">APP-1</ac:parameter></ac:structured-macro>` +
      `<h1>Empty</h1><h1>Last</h1><p>content</p>`,
    { toc: false },
  );
  const text = result.warnings.join("\n");
  assert.match(
    text,
    /"Overview" is immediately followed by a panel with the same title/,
  );
  assert.match(text, /"APP-1" only repeats the key/);
  assert.match(text, /Section "Empty" is empty/);
  assert.doesNotMatch(text, /"Last"/);
  // A parent section holding only subsections is not empty.
  assert.doesNotMatch(
    lint("<h1>Parent</h1><h2>Child</h2><p>x</p>").warnings.join(""),
    /empty/,
  );
});

void test("wraps loose inline content under block containers in paragraphs, once per run", () => {
  const date = '<time datetime="2026-01-02"/>';
  const result = lint(
    `<ac:structured-macro ac:name="info"><ac:rich-text-body><p>Due</p>${date}</ac:rich-text-body></ac:structured-macro>` +
      `<ul><li>${date} ok</li></ul><table><tbody><tr><td>${date}</td></tr></tbody></table>` +
      `stray <strong>text</strong>`,
  );
  assert.ok(
    result.storage.includes(`<p>Due</p><p>${date}</p></ac:rich-text-body>`),
  );
  assert.ok(
    result.storage.includes(`<li>${date} ok</li>`),
    "li keeps inline content",
  );
  assert.ok(
    result.storage.includes(`<td>${date}</td>`),
    "td keeps inline content",
  );
  assert.ok(result.storage.endsWith("<p>stray <strong>text</strong></p>"));
  const fix = result.fixes.filter((f) => f.startsWith("Wrapped"));
  assert.equal(fix.length, 1);
  assert.match(fix[0], /Wrapped 2 runs/);
  assertWellFormedStorage(result.storage);
});

void test("sets data-layout=default on Jira list macros only when missing", () => {
  const list = (attrs = "") =>
    `<ac:structured-macro ac:name="jira" ac:schema-version="1"${attrs}><ac:parameter ac:name="jqlQuery">project = A</ac:parameter></ac:structured-macro>`;
  const fixed = lint(list());
  assert.equal(fixed.storage, list(' data-layout="default"'));
  assert.equal(fixed.fixes.length, 1);
  assert.equal(
    lint(list(' data-layout="wide"')).storage,
    list(' data-layout="wide"'),
  );
  const single =
    '<p><ac:structured-macro ac:name="jira" ac:schema-version="1"><ac:parameter ac:name="key">A-1</ac:parameter></ac:structured-macro></p>';
  assert.equal(lint(single).storage, single);
});
