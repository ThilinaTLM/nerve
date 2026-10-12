import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveToolActivitySections } from "./tool-activity-state";

describe("tool argument lifecycle", () => {
  it("hides rejected assignment context while retaining the error and details", () => {
    for (const status of ["failed", "denied", "cancelled"] as const) {
      const sections = deriveToolActivitySections({
        toolCall: { status, error: "Assignments rejected" },
        argumentRegion: "until-settled",
        hasArgumentBody: true,
        hasDetailsAction: true,
      });
      assert.equal(sections.argumentVisible, false, status);
      assert.equal(sections.errorVisible, true, status);
      assert.equal(sections.resultMode, "none", status);
      assert.equal(sections.footerVisible, true, status);
    }
  });

  it("keeps assignment context before output and replaces it with results", () => {
    for (const status of [
      "committed",
      "waiting",
      "running",
      "completed",
    ] as const) {
      const sections = deriveToolActivitySections({
        toolCall: { status },
        argumentRegion: "until-settled",
        hasArgumentBody: true,
        bodyHydrated: true,
      });
      assert.equal(sections.argumentVisible, status !== "completed", status);
    }
    assert.equal(
      deriveToolActivitySections({
        argumentRegion: "until-settled",
        hasArgumentBody: true,
      }).argumentVisible,
      true,
    );
  });

  it("preserves failure input context for other argument policies", () => {
    for (const argumentRegion of ["persistent", "until-result"] as const) {
      assert.equal(
        deriveToolActivitySections({
          toolCall: { status: "failed", error: "Failed" },
          argumentRegion,
          hasArgumentBody: true,
        }).argumentVisible,
        true,
      );
    }
  });
});
