import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { guideCatalog, type GuideDefinition } from "./guide-catalog.js";
import { guideItemsForRun } from "./guide-content.js";
import {
  autoCompletedGuideIds,
  incompleteGuideCount,
  resolveGuides,
} from "./guide-catalog-policy.js";

const noSignals = {
  "project-open": false,
  "provider-ready": false,
  "voice-ready": false,
  "web-search-ready": false,
};

describe("guide catalog policy", () => {
  it("combines computed and local completion without conflating readiness", () => {
    const guides = resolveGuides(
      guideCatalog,
      { "scoped-models": 1 },
      { ...noSignals, "provider-ready": true },
    );
    assert.equal(
      guides.find((guide) => guide.id === "provider")?.completed,
      true,
    );
    assert.equal(guides.find((guide) => guide.id === "provider")?.ready, true);
    assert.equal(
      guides.find((guide) => guide.id === "scoped-models")?.completed,
      true,
    );
    assert.equal(
      guides.find((guide) => guide.id === "scoped-models")?.ready,
      undefined,
    );
    assert.deepEqual(autoCompletedGuideIds(guides, { "scoped-models": 1 }), [
      "provider",
    ]);
  });

  it("keeps explicit guides incomplete regardless of related configuration", () => {
    const guides = resolveGuides(
      guideCatalog,
      {},
      {
        "project-open": true,
        "provider-ready": true,
        "voice-ready": true,
        "web-search-ready": true,
      },
    );
    assert.equal(
      guides.find((guide) => guide.id === "agent-defaults")?.completed,
      false,
    );
    assert.equal(
      guides.find((guide) => guide.id === "scoped-models")?.completed,
      false,
    );
    assert.equal(
      guides.find((guide) => guide.id === "workbench")?.completed,
      false,
    );
  });

  it("auto-completes the optional web-search guide when Tavily is ready", () => {
    const guides = resolveGuides(
      guideCatalog,
      {},
      { ...noSignals, "web-search-ready": true },
    );
    const webSearch = guides.find((guide) => guide.id === "web-search");
    assert.equal(webSearch?.priority, "optional");
    assert.equal(webSearch?.ready, true);
    assert.equal(webSearch?.completed, true);
    assert.deepEqual(autoCompletedGuideIds(guides, {}), ["web-search"]);
  });

  it("excludes upcoming guides from incomplete counts", () => {
    const upcoming: GuideDefinition = {
      ...guideCatalog[0],
      lifecycle: "upcoming",
    };
    const guides = resolveGuides([upcoming, guideCatalog[1]], {}, noSignals);
    assert.equal(incompleteGuideCount(guides), 1);
  });

  it("runs only newly introduced Workbench steps until a manual replay", () => {
    const steps = [{ introducedIn: 1 }, { introducedIn: 2 }];
    assert.deepEqual(guideItemsForRun(steps, 1, false), [steps[1]]);
    assert.deepEqual(guideItemsForRun(steps, 2, true), steps);
  });
});
