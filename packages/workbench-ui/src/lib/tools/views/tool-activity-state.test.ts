import type {
  ConversationLiveToolDraftBlockSnapshot,
  ToolCallStatus,
  ToolCallTranscriptRecord,
} from "@nervekit/contracts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deriveToolActivitySections,
  deriveToolLifecycleVisualStage,
} from "./tool-activity-state";

function draft(done = false): ConversationLiveToolDraftBlockSnapshot {
  return {
    kind: "tool_call_draft",
    contentBlockId: "block_1",
    contentIndex: 0,
    toolName: "write",
    argsText: "",
    done,
  };
}

function toolCall(
  status: ToolCallStatus,
  error?: string,
): Pick<ToolCallTranscriptRecord, "status" | "error"> {
  return { status, error };
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
        toolCall: toolCall("pending_approval"),
      }),
      "approval",
    );
    assert.equal(
      deriveToolLifecycleVisualStage({
        toolCall: toolCall("waiting_for_user"),
      }),
      "interaction",
    );
    for (const status of ["requested", "running"] as const) {
      assert.equal(
        deriveToolLifecycleVisualStage({ toolCall: toolCall(status) }),
        "executing",
      );
    }
    assert.equal(
      deriveToolLifecycleVisualStage({ toolCall: toolCall("completed") }),
      "completed",
    );
    for (const status of ["error", "denied"] as const) {
      assert.equal(
        deriveToolLifecycleVisualStage({ toolCall: toolCall(status) }),
        "failed",
      );
    }
  });
});

describe("deriveToolActivitySections", () => {
  it("keeps persistent arguments visible on failure alongside the error", () => {
    const failed = deriveToolActivitySections({
      toolCall: toolCall("error", "boom"),
      argumentRegion: "persistent",
      hasArgumentBody: true,
    });
    assert.equal(failed.argumentVisible, true);
    assert.equal(failed.resultMode, "none");
    assert.equal(failed.errorVisible, true);
  });

  it("retains arguments during the tool-to-approval record handoff", () => {
    const state = deriveToolActivitySections({
      toolCall: toolCall("pending_approval"),
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
      toolCall: toolCall("waiting_for_user"),
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
