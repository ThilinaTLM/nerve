import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isolatedHtmlToMarkdown } from "../../src/execution/atlassian/isolated-html-to-markdown.js";

const md = (source: string) =>
  isolatedHtmlToMarkdown(source, { mode: "confluence-storage" });
const m = (name: string, body = "", params: Record<string, string> = {}) =>
  `<ac:structured-macro ac:name="${name}" ac:schema-version="1">${Object.entries(
    params,
  )
    .map(([k, v]) => `<ac:parameter ac:name="${k}">${v}</ac:parameter>`)
    .join(
      "",
    )}${body ? `<ac:rich-text-body>${body}</ac:rich-text-body>` : ""}</ac:structured-macro>`;

describe("Confluence storage macros to Markdown", () => {
  it("renders status inline, including inside table cells", async () => {
    assert.match(
      await md(
        `<p>State ${m("status", "", { title: "In progress", colour: "Blue" })} now</p>`,
      ),
      /State \\?\[In progress\\?\] now/,
    );
    const table = await md(
      `<table><tr><th>S</th></tr><tr><td>${m("status", "", { title: "Done" })}</td></tr></table>`,
    );
    assert.match(table, /\| \\?\[Done\\?\] \|/);
    assert.match(await md(m("status", "", { colour: "Green" })), /Green/);
  });

  it("renders panels with labels, titles and nested macros", async () => {
    const out = await md(
      m("info", `<p>Body ${m("status", "", { title: "OK" })}</p>`, {
        title: "Heads up",
      }),
    );
    assert.match(out, /^> \*\*Info: Heads up\*\*/);
    assert.match(out, /Body \\?\[OK\\?\]/);
    assert.doesNotMatch(out, /Heads up\s*\n.*Heads up|ac:|Confluence macro/);
    for (const [name, label] of [
      ["note", "Note"],
      ["warning", "Warning"],
      ["success", "Success"],
      ["error", "Error"],
      ["panel", "Panel"],
    ] as const) {
      assert.match(
        await md(m(name, "<p>x</p>")),
        new RegExp(`^> \\*\\*${label}:\\*\\*`),
      );
    }
  });

  it("renders expand with panel nested inside, and a title default", async () => {
    const out = await md(
      m("expand", m("note", "<p>inner</p>"), { title: "More" }),
    );
    assert.match(out, /\*\*More\*\*/);
    assert.match(out, /> \*\*Note:\*\*/);
    assert.match(out, /inner/);
    assert.match(await md(m("expand", "<p>b</p>")), /\*\*Details\*\*/);
  });

  it("renders jira keys and queries", async () => {
    assert.equal(await md(m("jira", "", { key: "APP-1" })), "APP-1");
    assert.equal(
      await md(m("jira", "", { jqlQuery: "project = A" })),
      "Jira issues: `project = A`",
    );
  });

  it("drops decorative macros", async () => {
    assert.equal(
      await md(`<p>a</p>${m("toc", "", { maxLevel: "2" })}${m("anchor")}`),
      "a",
    );
  });

  it("handles unknown macros with and without a body", async () => {
    const withBody = await md(m("custom", "<p>kept</p>", { foo: "leak" }));
    assert.equal(withBody, "kept");
    assert.match(await md(m("custom")), /\\?\[macro: custom\\?\]/);
    assert.equal(
      await md(`<ac:structured-macro ac:name="x"/>`),
      "\\[macro: x\\]",
    );
  });

  it("keeps code blocks and images working", async () => {
    const code = await md(
      `<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">ts</ac:parameter><ac:plain-text-body><![CDATA[a < b && <ac:structured-macro>]]></ac:plain-text-body></ac:structured-macro>`,
    );
    assert.match(code, /```ts\na < b && <ac:structured-macro>\n```/);
    assert.match(
      await md(`<ac:image><ri:attachment ri:filename="a.png"/></ac:image>`),
      /!\\?\[a\.png\\?\]\(a\.png\)/,
    );
  });
});
