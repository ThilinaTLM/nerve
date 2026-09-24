import type { ConversationLiveToolDraftBlockSnapshot } from "@nervekit/contracts/conversations";
import type {
  ToolCallStatus,
  ToolCallTranscriptRecord,
} from "@nervekit/contracts/tools";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toolLifecycleRegistry } from "../lifecycle/registry";
import {
  deriveToolActivitySections,
  deriveToolLifecycleVisualStage,
  outcomeUnknownToolCallIds,
  toolLifecycleStageIndicator,
} from "./tool-activity-state";

function draft(done = false): ConversationLiveToolDraftBlockSnapshot {
  return {
    kind: "tool_call_draft",
    contentBlockId: "block_1",
    contentIndex: 0,
    toolName: "write",
    argsText: "",
    progressRevision: 0,
    done,
  };
}

function toolCall(
  status: ToolCallStatus,
  error?: string,
  interactionKind?: "approval" | "user_input" | "plan_review",
): Pick<ToolCallTranscriptRecord, "status" | "error" | "interactions"> {
  return {
    status,
    error,
    interactions: interactionKind
      ? [{ kind: interactionKind, ordinal: 0, status: "pending" } as never]
      : [],
  };
}

describe("deriveToolLifecycleVisualStage", () => {
  it("maps the complete draft, interaction, execution, and terminal lifecycle", () => {
    assert.equal(
      deriveToolLifecycleVisualStage({ draft: draft() }),
      "drafting",
    );
    assert.equal(
      deriveToolLifecycleVisualStage({ draft: draft(true) }),
      "prepared",
    );
    assert.equal(
      deriveToolLifecycleVisualStage({
        toolCall: toolCall("waiting", undefined, "approval"),
      }),
      "approval",
    );
    assert.equal(
      deriveToolLifecycleVisualStage({
        toolCall: toolCall("waiting", undefined, "user_input"),
      }),
      "interaction",
    );
    assert.equal(
      deriveToolLifecycleVisualStage({ toolCall: toolCall("committed") }),
      "queued",
    );
    assert.equal(
      deriveToolLifecycleVisualStage({ toolCall: toolCall("running") }),
      "executing",
    );
    assert.equal(
      deriveToolLifecycleVisualStage({ toolCall: toolCall("completed") }),
      "completed",
    );
    for (const status of ["failed", "denied", "cancelled"] as const) {
      assert.equal(
        deriveToolLifecycleVisualStage({ toolCall: toolCall(status) }),
        "failed",
      );
    }
  });
});

describe("approved-tool checkpoint stages", () => {
  it("presents a committed call as queued without executing motion", () => {
    const indicator = toolLifecycleStageIndicator(
      deriveToolLifecycleVisualStage({ toolCall: toolCall("committed") }),
    );
    assert.deepEqual(indicator, {
      tone: "info",
      pulse: false,
      glyph: "pending",
      label: "Approved · queued",
    });
    assert.equal(toolLifecycleStageIndicator("executing"), undefined);

    const sections = deriveToolActivitySections({
      toolCall: toolCall("committed"),
      argumentRegion: "persistent",
      hasArgumentBody: true,
      resultPlaceholder: { variant: "text", rows: 2 },
      bodyHydrated: true,
    });
    assert.equal(sections.resultMode, "none");
    assert.equal(sections.argumentVisible, true);
  });

  it("marks a call named by an outcome_unknown recovery issue whatever its status", () => {
    const ids = outcomeUnknownToolCallIds([
      { code: "outcome_unknown", proposalId: "tool_a" },
      { code: "outcome_unknown" },
      { code: "stale_branch", proposalId: "tool_b" },
    ]);
    assert.deepEqual([...ids], ["tool_a"]);

    for (const status of ["committed", "running", "completed"] as const) {
      const stage = deriveToolLifecycleVisualStage({
        toolCall: toolCall(status),
        outcomeUnknown: true,
      });
      assert.equal(stage, "outcome_unknown");
      assert.deepEqual(toolLifecycleStageIndicator(stage), {
        tone: "warning",
        pulse: false,
        label: "Outcome unknown",
      });
    }

    const sections = deriveToolActivitySections({
      toolCall: toolCall("running"),
      argumentRegion: "persistent",
      hasArgumentBody: true,
      resultPlaceholder: { variant: "text", rows: 2 },
      bodyHydrated: true,
      outcomeUnknown: true,
    });
    assert.equal(sections.resultMode, "none");
  });
});

describe("deriveToolActivitySections", () => {
  it("keeps a prompt assignment mounted without a pending result placeholder", () => {
    const spec = toolLifecycleRegistry.subagent_prompt;
    for (const [status, resultMode] of [
      ["running", "none"],
      ["completed", "output"],
      ["failed", "none"],
    ] as const) {
      const sections = deriveToolActivitySections({
        toolCall: toolCall(status),
        argumentRegion: spec.argumentRegion,
        hasArgumentBody: true,
        bodyHydrated: true,
        resultPlaceholder: spec.resultPlaceholder,
      });
      assert.equal(sections.argumentVisible, true, status);
      assert.equal(sections.resultMode, resultMode, status);
    }
  });

  it("keeps persistent arguments visible on failure alongside the error", () => {
    const failed = deriveToolActivitySections({
      toolCall: toolCall("failed", "boom"),
      argumentRegion: "persistent",
      hasArgumentBody: true,
    });
    assert.equal(failed.argumentVisible, true);
    assert.equal(failed.resultMode, "none");
    assert.equal(failed.errorVisible, true);
  });

  it("shows cancellation as a terminal outcome with its reason", () => {
    const cancelled = deriveToolActivitySections({
      toolCall: toolCall("cancelled", "Run was cancelled."),
      argumentRegion: "persistent",
      hasArgumentBody: true,
      bodyHydrated: true,
    });
    assert.equal(cancelled.argumentVisible, true);
    assert.equal(cancelled.resultMode, "none");
    assert.equal(cancelled.errorVisible, true);
  });

  it("retains arguments during the tool-to-approval record handoff", () => {
    const state = deriveToolActivitySections({
      toolCall: toolCall("waiting"),
      argumentRegion: "until-result",
      hasArgumentBody: true,
      bodyHydrated: true,
    });
    assert.equal(state.argumentVisible, true);
    assert.equal(state.interactionMode, "none");
    assert.equal(state.resultMode, "none");
  });

  it("lets HIL views own the result section for every status", () => {
    const waiting = deriveToolActivitySections({
      toolCall: toolCall("waiting", undefined, "user_input"),
      argumentRegion: "until-result",
      hasArgumentBody: true,
      hasInteraction: true,
      bodyHydrated: true,
      hasDetailsAction: true,
    });
    assert.equal(waiting.resultMode, "output");
    assert.equal(waiting.argumentVisible, false);
    assert.equal(waiting.footerVisible, false);

    const resolved = deriveToolActivitySections({
      toolCall: toolCall("completed"),
      argumentRegion: "until-result",
      hasInteraction: true,
      bodyHydrated: true,
      hasDetailsAction: true,
    });
    assert.equal(resolved.resultMode, "output");
    assert.equal(resolved.footerVisible, false);
  });

  it("swaps the placeholder for output as soon as live content exists", () => {
    const live = deriveToolActivitySections({
      toolCall: toolCall("running"),
      argumentRegion: "persistent",
      hasArgumentBody: true,
      hasDurableBodyContent: true,
      resultPlaceholder: { variant: "text", rows: 2 },
      bodyHydrated: true,
    });
    assert.equal(live.resultMode, "output");
    assert.equal(live.argumentVisible, true);
  });

  it("does not fall back to arguments while completed output is deferred", () => {
    const deferred = deriveToolActivitySections({
      toolCall: toolCall("completed"),
      argumentRegion: "until-result",
      hasArgumentBody: true,
      hasDurableBodyContent: true,
      bodyHydrated: false,
    });
    assert.equal(deferred.resultMode, "none");
    assert.equal(deferred.argumentVisible, false);
  });

  it("changes footer signatures only for structural item changes", () => {
    const first = deriveToolActivitySections({
      toolCall: toolCall("completed"),
      argumentRegion: "none",
      bodyHydrated: true,
      footerItems: [{ tone: "success" }],
      hasDetailsAction: true,
    });
    const sameShape = deriveToolActivitySections({
      toolCall: toolCall("completed"),
      argumentRegion: "none",
      bodyHydrated: true,
      footerItems: [{ tone: "success" }],
      hasDetailsAction: true,
    });
    const extraItem = deriveToolActivitySections({
      toolCall: toolCall("completed"),
      argumentRegion: "none",
      bodyHydrated: true,
      footerItems: [{ tone: "success" }, { mono: true }],
      hasDetailsAction: true,
    });
    assert.equal(first.footerVisible, true);
    assert.equal(first.structuralRevision, sameShape.structuralRevision);
    assert.notEqual(first.structuralRevision, extraItem.structuralRevision);
  });
});
