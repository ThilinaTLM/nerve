import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { markdownToStorage } from "../../confluence/markdown-to-storage.js";
import { STORAGE_PRELUDE } from "./storage-helpers.js";

type Storage = Record<string, (...args: unknown[]) => string>;
type Host = {
  pages: Record<string, (options: Record<string, unknown>) => unknown>;
  comments: Record<string, (options: Record<string, unknown>) => unknown>;
};

/** Fresh `storage` global, as in one sandbox run. */
function load(confluence?: Host): Storage {
  const context: { storage?: Storage; confluence?: Host } = { confluence };
  runInNewContext(STORAGE_PRELUDE, context);
  return context.storage as Storage;
}

const INJECTION = 'x <ac:structured-macro ac:name="toc"/> <b>y</b>';

void test("plain strings are escaped, builder output and raw() are not", () => {
  const storage = load();
  const escaped =
    "x &lt;ac:structured-macro ac:name=&quot;toc&quot;/&gt; &lt;b&gt;y&lt;/b&gt;";
  assert.equal(storage.p(INJECTION), `<p>${escaped}</p>`);
  assert.equal(storage.p("a < b"), "<p>a &lt; b</p>");
  assert.match(
    storage.table([[INJECTION]], { columns: ["c"] }),
    /<td><p>x &lt;ac:/,
  );
  assert.match(storage.tasks([INJECTION]), /<ac:task-body>x &lt;ac:/);
  // Markdown bodies that are really storage XHTML are refused, not escaped.
  assert.throws(() => storage.panel("info", INJECTION), /not trusted markup/);

  const status = storage.status("Done", "green");
  assert.equal(
    storage.p([status, " ", storage.link("#a", "<l>")]),
    `<p>${status} <a href="#a">&lt;l&gt;</a></p>`,
  );
  assert.equal(storage.p(status), `<p>${status}</p>`);
  assert.equal(
    storage.p(`${status}!`),
    `<p>${status.replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")}!</p>`,
  );
  assert.match(
    storage.table([[status]], { columns: ["c"] }),
    new RegExp(`<td>${status}</td>`),
  );

  const fragment = '<ac:emoticon ac:name="smile"/>';
  assert.equal(storage.p([storage.raw(fragment)]), `<p>${fragment}</p>`);
  assert.equal(
    storage.panel("info", storage.raw("<p>hi</p>")).includes("<p>hi</p>"),
    true,
  );
});

void test("trust is per run", () => {
  const status = load().status("Done");
  assert.match(load().p(status), /&lt;ac:structured-macro/);
});

void test("table widths must be positive numbers and links need safe URLs", () => {
  const storage = load();
  for (const width of ['1px;" onclick="x', "abc", -5, 0]) {
    assert.throws(
      () => storage.table([{ a: "1" }], { columns: [{ key: "a", width }] }),
      /column width/,
    );
  }
  assert.match(
    storage.table([{ a: "1" }], { columns: [{ key: "a", width: "120" }] }),
    /width: 120px/,
  );
  for (const url of [
    "javascript:alert(1)",
    " JaVa\nscript:x",
    "data:text/html,x",
    "vbscript:x",
  ]) {
    assert.throws(() => storage.link(url, "x"), /unsupported URL/);
  }
  for (const url of [
    "https://x.test/a?b=1&c=2",
    "mailto:a@b.c",
    "/wiki/x",
    "#anchor",
    "rel/path",
  ]) {
    assert.match(storage.link(url, "x"), /^<a href="/);
  }
});

void test("Markdown links with unsafe URLs lose the link", () => {
  assert.equal(markdownToStorage("[x](javascript:alert(1))"), "<p>x</p>");
  assert.equal(
    markdownToStorage("[x](https://a.test)"),
    '<p><a href="https://a.test">x</a></p>',
  );
  const storage = load();
  assert.equal(
    storage.expand("t", "[x](data:text/html,a)").includes("<p>x</p>"),
    true,
  );
});

void test("task ids are unique across tasks() and markdown() in one page", () => {
  const storage = load();
  const page = [
    storage.tasks(["a", "b"]),
    storage.panel("info", "- [ ] c\n- [x] d"),
    storage.panel("info", "- [ ] e"),
    storage.tasks(["f"]),
  ].join("");
  const ids = [...page.matchAll(/<ac:task-id>(\d+)</g)].map((m) => m[1]);
  assert.equal(ids.length, 6);
  assert.equal(new Set(ids).size, 6);
});

void test("untrusted storage XHTML is rejected, never escaped silently", () => {
  const storage = load();
  const status = storage.status("Done");
  for (const body of [
    `${status}<p>x</p>`,
    "<p>x</p>",
    '<ac:structured-macro ac:name="toc"/>',
    "text</p>",
  ]) {
    assert.throws(() => storage.panel("info", body), /storage\.raw|array/);
  }
  // HTML in code spans and fences is prose, not markup.
  assert.doesNotThrow(() =>
    storage.panel("info", "use `<p>` or\n```\n<ac:x/>\n```"),
  );
  assert.doesNotThrow(() => storage.panel("info", "a < b and 2 > 1"));
  assert.match(storage.panel("info", [status, "more"]), /<p>more<\/p>/);
});

void test("RichText bodies reach the host as storage; page.body stays trusted", async () => {
  const seen: Record<string, unknown>[] = [];
  const host: Host = {
    pages: {
      create: (o) => seen.push(o),
      update: (o) => seen.push(o),
      get: async () => ({
        body: '<p>old</p><ac:structured-macro ac:name="drawio"/>',
      }),
    },
    comments: { add: (o) => seen.push(o) },
  };
  const storage = load(host);
  const page = (await host.pages.get({ id: "1", body: "storage" })) as {
    body: string;
  };
  host.pages.update({
    id: "1",
    body: [page.body, "## New", storage.status("Done")],
  });
  host.pages.create({ title: "t", body: "# H\n\nhi" });
  host.comments.add({ id: "1", body: "**hi**" });
  assert.equal(
    seen[0].body,
    `${page.body}<h2>New</h2>${storage.status("Done")}`,
  );
  assert.match(String(seen[1].body), /^<h1>H<\/h1><p>hi<\/p>$/);
  assert.match(String(seen[2].body), /<strong>hi<\/strong>/);
  assert.throws(
    () => host.pages.update({ id: "1", body: page.body + "<p>x</p>" }),
    /not trusted markup/,
  );
  // bodyFile and plain reads are untouched.
  host.pages.update({ id: "1", bodyFile: "artifact:p.xhtml" });
  assert.equal(seen[3].bodyFile, "artifact:p.xhtml");
});

void test("replaceSection swaps the content under a heading only", () => {
  const storage = load();
  const body = storage.raw(
    "<h1>A</h1><p>a</p><h2>B</h2><p>b</p><h3>C</h3><p>c</p><h2>D</h2><p>d</p><h1>E</h1><p>e</p>",
  );
  assert.equal(
    storage.replaceSection(body, "B", "new"),
    "<h1>A</h1><p>a</p><h2>B</h2><p>new</p><h2>D</h2><p>d</p><h1>E</h1><p>e</p>",
  );
  assert.equal(
    storage
      .replaceSection(body, "E", ["x", storage.status("Ok")])
      .startsWith("<h1>A</h1>"),
    true,
  );
  assert.throws(
    () => storage.replaceSection(body, "Nope", "x"),
    /Headings: A \| B \| C \| D \| E/,
  );
  // A heading inside a container ends at the container's end.
  const nested = storage.raw(
    '<h1>A</h1><ac:layout><ac:layout-section ac:type="two_equal"><ac:layout-cell><h2>In</h2><p>x</p></ac:layout-cell><ac:layout-cell><p>y</p></ac:layout-cell></ac:layout-section></ac:layout><h1>Z</h1>',
  );
  assert.match(
    storage.replaceSection(nested, "In", "n"),
    /<h2>In<\/h2><p>n<\/p><\/ac:layout-cell><ac:layout-cell>/,
  );
});

void test("element builders produce the Cloud storage forms", () => {
  const storage = load();
  assert.equal(
    storage.link({ page: "Other page", space: "ENG" }, "see"),
    '<ac:link><ri:page ri:content-title="Other page" ri:space-key="ENG"/><ac:plain-text-link-body><![CDATA[see]]></ac:plain-text-link-body></ac:link>',
  );
  assert.match(
    storage.link({ attachment: "a.pdf" }),
    /<ri:attachment ri:filename="a.pdf"\/>/,
  );
  assert.match(
    storage.viewFile("a.pdf", { height: 300 }),
    /ac:name="view-file".*<ri:attachment ri:filename="a.pdf"\/>.*height">300/,
  );
  assert.match(
    storage.image("https://x.test/a.png", { border: true }),
    /ac:border="true"><ri:url ri:value="https:\/\/x.test\/a.png"\/>/,
  );
  assert.match(
    storage.layout(["a", "b", "c"], { type: "three_with_sidebars" }),
    /three_with_sidebars/,
  );
  assert.match(
    storage.code("x", { lineNumbers: true, collapse: true }),
    /linenumbers">true.*collapse">true/,
  );
  assert.match(
    storage.decisions(["Ship it"]),
    /decision-item.*DECIDED.*Ship it/,
  );
  assert.throws(() => storage.date("tomorrow"), /YYYY-MM-DD/);
  const table = storage.table([[{ text: "wide", colspan: 2 }], ["k", "v"]], {
    headerRow: false,
    headerColumn: true,
  });
  assert.match(
    table,
    /<tr><th colspan="2"><p>wide<\/p><\/th><\/tr><tr><th><p>k<\/p><\/th><td><p>v<\/p><\/td><\/tr>/,
  );
  assert.match(
    storage.pageProperties({ Owner: "Ann" }),
    /ac:name="details".*<th><p>Owner<\/p><\/th><td><p>Ann<\/p><\/td>/,
  );
});
