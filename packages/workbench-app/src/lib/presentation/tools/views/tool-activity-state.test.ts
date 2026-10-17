import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deriveToolActivitySections,
  deriveToolLifecycleVisualStage,
  leadStageFor,
  toolLifecycleStageIndicator,
  visibleLifecycleStage,
} from "./tool-activity-state";

describe("tool lifecycle visual stage", () => {
  it("shows cancellation separately from failure without pulsing", () => {
    const stage = deriveToolLifecycleVisualStage({
      toolCall: { status: "cancelled" },
    });
    assert.equal(stage, "cancelled");
    assert.equal(visibleLifecycleStage(stage, false), "cancelled");
    assert.deepEqual(toolLifecycleStageIndicator(stage), {
      tone: "warning",
      pulse: false,
      label: "Cancelled",
    });

    for (const status of ["failed", "denied"] as const) {
      assert.equal(
        deriveToolLifecycleVisualStage({ toolCall: { status } }),
        "failed",
      );
    }
  });

  it("keeps genuine recovery uncertainty ahead of terminal status", () => {
    for (const status of ["cancelled", "failed", "completed"] as const) {
      const stage = deriveToolLifecycleVisualStage({
        toolCall: { status },
        outcomeUnknown: true,
      });
      assert.equal(stage, "outcome_unknown", status);
      assert.deepEqual(toolLifecycleStageIndicator(stage), {
        tone: "warning",
        pulse: false,
        label: "Outcome unknown",
      });
    }
  });
});

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

describe("lead stage", () => {
  it("shows supervising calls as checking instead of queued", () => {
    const stage = deriveToolLifecycleVisualStage({
      toolCall: { status: "committed", supervising: true },
    });
    assert.equal(stage, "supervising");
    assert.equal(leadStageFor(stage), "supervising");
    assert.equal(
      deriveToolLifecycleVisualStage({ toolCall: { status: "committed" } }),
      "queued",
    );
  });

  it("separates denied from failed and keeps drafts at drafting", () => {
    assert.equal(leadStageFor("failed", "denied"), "denied");
    assert.equal(leadStageFor("failed", "failed"), "failed");
    assert.equal(leadStageFor("prepared"), "drafting");
    assert.equal(leadStageFor("interaction"), "waiting_for_user");
    assert.equal(leadStageFor("executing"), "running");
  });

  it("keeps the footer through approval but not interactive tools", () => {
    const base = {
      toolCall: { status: "waiting" as const },
      argumentRegion: "persistent" as const,
      footerItems: [{ key: "lead", text: "needs approval" }],
    };
    assert.equal(
      deriveToolActivitySections({ ...base, hasApproval: true }).footerVisible,
      true,
    );
    assert.equal(
      deriveToolActivitySections({ ...base, hasInteraction: true })
        .footerVisible,
      false,
    );
  });
});
