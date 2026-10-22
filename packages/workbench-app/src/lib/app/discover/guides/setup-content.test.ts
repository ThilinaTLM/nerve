import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pagesByScope } from "$lib/features/settings/registry/settings-page-data";
import { setupGuideSteps } from "./setup-content";

/* Guide steps navigate Settings by page and section id. Those ids are plain
 * strings, so moving a page silently strands a step on a target that no longer
 * exists. The page contract lives in a component-free data module, so it is
 * imported directly. Guides open the user settings tab. */
function parseRegistry(): Map<string, Set<string>> {
  return new Map(
    Object.entries(pagesByScope.user).map(([pageId, page]) => [
      pageId,
      new Set(page.sections.map((section) => section.id)),
    ]),
  );
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

  it("keeps section ids unique within each page", () => {
    // Only one page renders at a time, so ids may repeat across pages.
    for (const [scope, pages] of Object.entries(pagesByScope))
      for (const [pageId, page] of Object.entries(pages)) {
        const ids = page.sections.map((section) => section.id);
        assert.equal(
          new Set(ids).size,
          ids.length,
          `duplicate section id on ${scope}/${pageId}`,
        );
      }
  });
});
