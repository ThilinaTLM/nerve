import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { markdownToStorage } from "../confluence/markdown-to-storage.js";
import { STORAGE_PRELUDE } from "./storage-helpers.js";

type Storage = Record<string, (...args: unknown[]) => string>;

/** Fresh `storage` global, as in one sandbox run. */
function load(): Storage {
  const context: { storage?: Storage } = {};
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
  assert.match(
    storage.panel("info", INJECTION),
    /<p>x &lt;ac:structured-macro/,
  );

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
  assert.equal(storage.markdown("[x](data:text/html,a)"), "<p>x</p>");
});

void test("task ids are unique across tasks() and markdown() in one page", () => {
  const storage = load();
  const page = [
    storage.tasks(["a", "b"]),
    storage.markdown("- [ ] c\n- [x] d"),
    storage.panel("info", "- [ ] e"),
    storage.tasks(["f"]),
  ].join("");
  const ids = [...page.matchAll(/<ac:task-id>(\d+)</g)].map((m) => m[1]);
  assert.equal(ids.length, 6);
  assert.equal(new Set(ids).size, 6);
});
