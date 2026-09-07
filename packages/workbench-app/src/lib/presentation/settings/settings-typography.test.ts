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

  it("keeps row supporting text muted and under the title", () => {
    assert.match(
      source("./SettingsListItem.svelte"),
      /class="truncate text-xs text-muted-foreground">\s*\{description\}/s,
      "list item description should be text-xs muted",
    );
  });

  it("keeps headings free of description paragraphs", () => {
    /* Section detail belongs in an info tooltip beside the heading. A paragraph
     * under every heading put section-level and row-level grey text in the same
     * tier, so nothing said which one a line belonged to. */
    for (const path of ["./SettingsSection.svelte", "./SettingsGroup.svelte"]) {
      const text = source(path);
      assert.doesNotMatch(
        text,
        /description/,
        `${path} should expose an info tooltip, not a description`,
      );
      assert.match(text, /SettingsInfoHint/, `${path} should offer info`);
    }
  });
});
