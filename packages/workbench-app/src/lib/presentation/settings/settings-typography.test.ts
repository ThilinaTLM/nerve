import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/* Settings has three heading levels (page title text-title, section heading
 * text-ui semibold, entity title text-ui medium) over text-ui rows and text-caption
 * supporting text, so weight and colour carry most of the hierarchy. That is easy to break by accident: the section header
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
  const listItem = source("./SettingsListItem.svelte");
  const entityTitle = heading(source("./EntityCard.svelte"), "h4");
  const nav = source("./SettingsNav.svelte");

  it("ranks the page title above section titles", () => {
    assert.match(pageTitle, /text-title/);
    assert.match(pageTitle, /font-semibold/);
    assert.match(sectionTitle, /text-ui/);
  });

  it("keeps section headings stronger than the rows they contain", () => {
    // Same size; the heading wins on weight and the row stays regular.
    assert.match(sectionTitle, /font-semibold/);
    assert.match(sectionTitle, /text-foreground/);

    const rowTitle = /<span\s+class="([^"]+)"\s*>\s*\{title\}/s.exec(listItem);
    assert.ok(rowTitle, "expected a list item title span");
    assert.match(rowTitle[1], /\btext-ui\b/);
    assert.doesNotMatch(
      rowTitle[1],
      /font-(medium|semibold|bold)/,
      "row titles must stay regular weight or they compete with section headings",
    );
    assert.match(rowTitle[1], /text-foreground/);
  });

  it("keeps entity titles one step below section headings", () => {
    assert.match(entityTitle, /text-ui/);
    assert.match(entityTitle, /font-medium/);
    assert.doesNotMatch(entityTitle, /font-semibold/);
    assert.match(entityTitle, /text-foreground/);
  });

  it("separates nav group captions from items by weight, colour and icon", () => {
    // Group captions are the shared GroupLabel: caption size, medium weight,
    // muted, sentence case.
    assert.match(nav, /<GroupLabel[^>]*label=\{group\.title\}/s);
    const groupLabel = source(
      "../../../../../ui-kit/src/lib/components/composites/group-label/group-label.svelte",
    );
    assert.match(groupLabel, /text-caption font-medium text-muted-foreground/);
    assert.doesNotMatch(groupLabel, /(?<![\w-])uppercase(?![\w-])/);
    assert.match(nav, /text-ui text-foreground/);
    assert.match(nav, /bg-selected font-medium/);
  });

  it("uses sentence case, never uppercase, for headings", () => {
    for (const [name, classes] of [
      ["page", pageTitle],
      ["section", sectionTitle],
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
      /class="truncate text-caption text-muted-foreground">\s*\{description\}/s,
      "list item description should be text-caption muted",
    );
  });

  it("keeps heading descriptions to one muted line", () => {
    /* A section may carry one text-caption muted line under its heading, never a
     * paragraph at row size; longer detail goes in an info tooltip. */
    const section = source("./SettingsSection.svelte");
    assert.match(
      section,
      /<p class="text-caption text-muted-foreground">\{description\}<\/p>/,
    );
    assert.match(section, /SettingsInfoHint/);
  });

  it("separates sections with a surface, and nested cards sit flush in it", () => {
    /* Sections sitting straight on the page read as one undivided stream. The
     * surface separates them; cards inside it drop their own chrome so they
     * never stack card-in-card. */
    const section = source("./SettingsSection.svelte");
    assert.match(section, /data-settings-surface/);
    assert.match(section, /rounded-lg border bg-card/);
    assert.match(
      section,
      /divide-y divide-border/,
      "divided rows use hairlines",
    );
    for (const path of [
      "./SettingsList.svelte",
      "./SettingsEmptyState.svelte",
    ]) {
      assert.match(
        source(path),
        /group-data-settings-surface\/surface:/,
        `${path} should sit flush inside a section surface`,
      );
    }
  });
});
