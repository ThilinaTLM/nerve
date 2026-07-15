import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ConversationLiveToolDraftBlockSnapshot,
  ToolCallStatus,
  ToolCallTranscriptRecord,
} from "@nervekit/contracts";
import { deriveToolActivityState } from "./tool-activity-state";

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

describe("deriveToolActivityState", () => {
  it("keeps an empty draft header-only and expands meaningful previews", () => {
    const empty = deriveToolActivityState({ draft: draft() });
    assert.equal(empty.phase, "drafting");
    assert.equal(empty.bodyMode, "none");
    assert.equal(empty.bodyVisible, false);

    const preview = deriveToolActivityState({
      draft: draft(),
      hasMeaningfulDraftBody: true,
    });
    assert.equal(preview.bodyMode, "draft-preview");
    assert.equal(preview.bodyVisible, true);
  });

  it("represents a prepared draft without requiring a durable record", () => {
    const state = deriveToolActivityState({ draft: draft(true) });
    assert.equal(state.phase, "prepared");
    assert.equal(state.bodyMode, "none");
  });

  it("uses every durable status as the activity phase", () => {
    const statuses: ToolCallStatus[] = [
      "requested",
      "pending_approval",
      "waiting_for_user",
      "running",
      "completed",
      "denied",
      "error",
    ];
    for (const status of statuses) {
      assert.equal(
        deriveToolActivityState({ toolCall: toolCall(status) }).phase,
        status,
      );
    }
  });

  it("selects approval, interaction, output, and error body modes", () => {
    assert.equal(
      deriveToolActivityState({
        toolCall: toolCall("pending_approval"),
        hasApproval: true,
      }).bodyMode,
      "approval",
    );
    assert.equal(
      deriveToolActivityState({
        toolCall: toolCall("waiting_for_user"),
        hasInteraction: true,
        bodyHydrated: true,
      }).bodyMode,
      "interaction",
    );
    assert.equal(
      deriveToolActivityState({
        toolCall: toolCall("running"),
        bodyHydrated: true,
      }).bodyMode,
      "tool-output",
    );
    const failed = deriveToolActivityState({
      toolCall: toolCall("error", "boom"),
      bodyHydrated: true,
    });
    assert.equal(failed.bodyMode, "error");
    assert.equal(failed.errorVisible, true);
    assert.equal(failed.bodyVisible, false);
    assert.equal(
      deriveToolActivityState({ toolCall: toolCall("denied") }).bodyMode,
      "error",
    );
  });

  it("keeps a meaningful draft body until durable output is available", () => {
    const handoff = deriveToolActivityState({
      draft: draft(true),
      toolCall: toolCall("running"),
      hasMeaningfulDraftBody: true,
      hasDurableBodyContent: false,
      bodyHydrated: true,
    });
    assert.equal(handoff.phase, "running");
    assert.equal(handoff.bodyMode, "draft-preview");
    assert.equal(handoff.bodyVisible, true);

    const output = deriveToolActivityState({
      draft: draft(true),
      toolCall: toolCall("running"),
      hasMeaningfulDraftBody: true,
      hasDurableBodyContent: true,
      bodyHydrated: true,
    });
    assert.equal(output.bodyMode, "tool-output");
    assert.notEqual(handoff.structuralRevision, output.structuralRevision);
  });

  it("tracks body hydration without changing for streamed content", () => {
    const hidden = deriveToolActivityState({
      toolCall: toolCall("running"),
      bodyHydrated: false,
    });
    const visible = deriveToolActivityState({
      toolCall: toolCall("running"),
      bodyHydrated: true,
    });
    assert.equal(hidden.bodyVisible, false);
    assert.equal(visible.bodyVisible, true);
    assert.notEqual(hidden.structuralRevision, visible.structuralRevision);
    assert.equal(
      visible.structuralRevision,
      deriveToolActivityState({
        toolCall: toolCall("completed"),
        bodyHydrated: true,
      }).structuralRevision,
    );
  });

  it("changes footer signatures only for structural item changes", () => {
    const first = deriveToolActivityState({
      toolCall: toolCall("completed"),
      bodyHydrated: true,
      footerItems: [{ tone: "success" }],
      hasDetailsAction: true,
    });
    const sameShape = deriveToolActivityState({
      toolCall: toolCall("completed"),
      bodyHydrated: true,
      footerItems: [{ tone: "success" }],
      hasDetailsAction: true,
    });
    const extraItem = deriveToolActivityState({
      toolCall: toolCall("completed"),
      bodyHydrated: true,
      footerItems: [{ tone: "success" }, { mono: true }],
      hasDetailsAction: true,
    });
    assert.equal(first.footerVisible, true);
    assert.equal(first.structuralRevision, sameShape.structuralRevision);
    assert.notEqual(first.structuralRevision, extraItem.structuralRevision);

    const approval = deriveToolActivityState({
      toolCall: toolCall("pending_approval"),
      hasApproval: true,
      footerItems: [{ tone: "warning" }],
    });
    assert.equal(approval.footerVisible, false);
  });
});
