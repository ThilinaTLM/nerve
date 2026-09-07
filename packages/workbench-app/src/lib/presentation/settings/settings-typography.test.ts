import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/* Settings has four text roles and only three sizes, so weight and colour carry
 * most of the hierarchy. That is easy to break by accident: the section header
 * was once a 12px muted uppercase eyebrow sitting above 14px foreground row
 * titles, which made every section rank below its own content. */
function source(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    "utf8",
  );
}

function heading(text: string, tag: string): string {
  const match = new RegExp(`<${tag}[^>]*?class="([^"]+)"`, "s").exec(text);
  assert.ok(match, `expected a <${tag}> with a class list`);
  return match[1];
}

describe("settings typography", () => {
  const pageTitle = heading(source("./SettingsPageHeader.svelte"), "h2");
  const sectionTitle = heading(source("./SettingsSection.svelte"), "h3");
  const groupTitle = heading(source("./SettingsGroup.svelte"), "h4");
  const listItem = source("./SettingsListItem.svelte");

  it("ranks the page title above section titles", () => {
    assert.match(pageTitle, /text-base/);
    assert.match(pageTitle, /font-semibold/);
    assert.match(sectionTitle, /text-sm/);
  });

  it("keeps section headings stronger than the rows they contain", () => {
    // Same size; the heading wins on weight and the row stays regular.
    assert.match(sectionTitle, /font-semibold/);
    assert.match(sectionTitle, /text-foreground/);

    const rowTitle = /<span class="truncate (text-sm[^"]*)">\{title\}/.exec(
      listItem,
    );
    assert.ok(rowTitle, "expected a list item title span");
    assert.doesNotMatch(
      rowTitle[1],
      /font-(medium|semibold|bold)/,
      "row titles must stay regular weight or they compete with section headings",
    );
    assert.match(rowTitle[1], /text-foreground/);
  });

  it("keeps group headings subordinate to section headings", () => {
    // Nested inside a section, so it steps down in colour rather than weight.
    assert.match(groupTitle, /font-semibold/);
    assert.match(groupTitle, /text-muted-foreground/);
  });

  it("uses sentence case, never uppercase, for headings", () => {
    for (const [name, classes] of [
      ["page", pageTitle],
      ["section", sectionTitle],
      ["group", groupTitle],
    ] as const) {
      assert.doesNotMatch(
        classes,
        /(?<![\w-])uppercase(?![\w-])/,
        `${name} heading should not be uppercased`,
      );
    }
  });

  it("keeps supporting text muted and below the titles it describes", () => {
    for (const path of [
      "./SettingsSection.svelte",
      "./SettingsGroup.svelte",
      "./SettingsListItem.svelte",
    ]) {
      assert.match(
        source(path),
        /\{description\}/,
        `${path} should render a description`,
      );
      assert.match(
        source(path),
        /class="[^"]*text-xs[^"]*text-muted-foreground[^"]*"[^>]*>\s*\{?\s*description/s,
        `${path} description should be text-xs muted`,
      );
    }
  });
});
