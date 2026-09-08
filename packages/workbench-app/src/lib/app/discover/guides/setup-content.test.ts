import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { setupGuideSteps } from "./setup-content";

/* Guide steps navigate Settings by page and section id. Those ids are plain
 * strings, so moving a page silently strands a step on a target that no longer
 * exists — which is how the Explore step ended up pointing at a section named
 * "explore-agent" that was never registered.
 *
 * The registry itself imports Lucide icon components (`.svelte`), which the node
 * test runner cannot load, so the page shape is read from source the same way
 * the theme drift guards read `theme.css`. */
const registrySource = readFileSync(
  fileURLToPath(
    new URL(
      "../../../features/settings/registry/settings-pages.ts",
      import.meta.url,
    ),
  ),
  "utf8",
);

function parseRegistry(): Map<string, Set<string>> {
  const pages = new Map<string, Set<string>>();
  const pageBlocks = registrySource.split(/\n {2}\{\n/).slice(1);
  for (const block of pageBlocks) {
    const pageId = /^\s*id: "([^"]+)"/m.exec(block)?.[1];
    if (!pageId) continue;
    const sectionsBlock = /sections: \[([\s\S]*?)\],\n/.exec(block)?.[1] ?? "";
    const sectionIds = [...sectionsBlock.matchAll(/id: "([^"]+)"/g)].map(
      (match) => match[1],
    );
    pages.set(pageId, new Set(sectionIds));
  }
  return pages;
}

describe("setup guide settings targets", () => {
  const sectionsByPage = parseRegistry();

  it("parses every registered page", () => {
    assert.ok(sectionsByPage.size >= 10, "expected the full page registry");
    for (const [pageId, sections] of sectionsByPage) {
      assert.ok(sections.size > 0, `page "${pageId}" has no sections`);
    }
  });

  it("resolves every settings target referenced by a setup guide step", () => {
    const steps = Object.values(setupGuideSteps).flat();
    const settingsSteps = steps.filter(
      (step) => step.preparation?.kind === "settings",
    );
    assert.ok(settingsSteps.length > 0, "expected settings guide steps");

    for (const step of settingsSteps) {
      const preparation = step.preparation;
      if (preparation?.kind !== "settings") continue;
      const sections = sectionsByPage.get(preparation.pageId);
      assert.ok(
        sections,
        `guide step "${step.id}" targets unknown settings page "${preparation.pageId}"`,
      );
      if (preparation.sectionId === undefined) continue;
      assert.ok(
        sections.has(preparation.sectionId),
        `guide step "${step.id}" targets unknown section "${preparation.sectionId}" on page "${preparation.pageId}"`,
      );
    }
  });

  it("keeps section ids unique across pages", () => {
    // Section ids become DOM ids (`settings-section-<id>`) in one namespace.
    const sectionIds = [...sectionsByPage.values()].flatMap((sections) => [
      ...sections,
    ]);
    assert.equal(
      new Set(sectionIds).size,
      sectionIds.length,
      "duplicate settings section id across pages",
    );
  });
});
