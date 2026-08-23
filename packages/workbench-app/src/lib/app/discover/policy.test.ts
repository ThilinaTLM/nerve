import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { discoverEditorialCatalog } from "./catalog.js";
import {
  buildDiscoverSections,
  discoverAttentionCount,
  resolveDiscoverEditorial,
  shouldOpenDiscoverOnStartup,
  unseenEditorialCount,
} from "./policy.js";
import { guideCatalog } from "./guides/catalog.js";
import { resolveGuides } from "./guides/catalog-policy.js";

const noSignals = {
  "project-open": false,
  "provider-ready": false,
  "voice-ready": false,
  "web-search-ready": false,
};

describe("Discover policy", () => {
  it("prioritizes required setup and demotes completed guides", () => {
    const guides = resolveGuides(
      guideCatalog,
      { provider: 1, workbench: 1 },
      noSignals,
    );
    const editorial = resolveDiscoverEditorial(discoverEditorialCatalog, {});
    const sections = buildDiscoverSections(guides, editorial);

    assert.equal(sections.startHere[0]?.id, "open-project");
    assert.equal(
      sections.startHere.some((guide) => guide.id === "provider"),
      false,
    );
    assert.equal(
      sections.completed.some((guide) => guide.id === "provider"),
      true,
    );
    assert.equal(
      sections.completed.some((guide) => guide.id === "workbench"),
      true,
    );
    assert.deepEqual(
      sections.highlights.map((item) => item.id),
      ["discover-home", "workbench-tour"],
    );
    assert.deepEqual(
      sections.highlights.map((item) => item.artwork),
      ["discover", "workbench"],
    );
    assert.deepEqual(
      sections.tips.map((item) => item.id),
      ["focused-model-list", "tool-selection"],
    );
    assert.equal(sections.startHere.at(-1)?.id, "web-search");
    assert.deepEqual(
      sections.tips.find((item) => item.id === "tool-selection")?.action,
      {
        kind: "settings",
        pageId: "tools",
        sectionId: "third-party",
        label: "Review third-party tools",
      },
    );
  });

  it("tracks editorial attention separately from guide completion", () => {
    const unread = resolveDiscoverEditorial(discoverEditorialCatalog, {});
    const seen = resolveDiscoverEditorial(discoverEditorialCatalog, {
      "discover-home": 1,
      "workbench-tour": 1,
      "focused-model-list": 1,
      "tool-selection": 1,
    });

    assert.equal(unseenEditorialCount(unread), 4);
    assert.equal(unseenEditorialCount(seen), 0);
    assert.equal(
      discoverAttentionCount({
        incompleteGuideCount: 3,
        unseenEditorialCount: 4,
      }),
      7,
    );
  });

  it("opens once per ready startup generation regardless of completion", () => {
    const base = {
      progressiveActive: true,
      settingsLoaded: true,
      generation: 3,
    };
    assert.equal(shouldOpenDiscoverOnStartup(base), true);
    assert.equal(
      shouldOpenDiscoverOnStartup({ ...base, consideredGeneration: 3 }),
      false,
    );
    assert.equal(
      shouldOpenDiscoverOnStartup({ ...base, progressiveActive: false }),
      false,
    );
    assert.equal(
      shouldOpenDiscoverOnStartup({
        ...base,
        generation: 4,
        consideredGeneration: 3,
      }),
      true,
    );
  });
});
