import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ConversationLiveToolDraftBlockSnapshot,
  ToolCallStatus,
  ToolCallTranscriptRecord,
} from "@nervekit/contracts";
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
  it("keeps an empty draft header-only and mounts argument bodies", () => {
    const empty = deriveToolActivitySections({
      draft: draft(),
      argumentRegion: "until-result",
    });
    assert.equal(empty.phase, "drafting");
    assert.equal(empty.argumentVisible, false);
    assert.equal(empty.resultMode, "none");

    const preview = deriveToolActivitySections({
      draft: draft(),
      argumentRegion: "until-result",
      hasArgumentBody: true,
    });
    assert.equal(preview.argumentVisible, true);
  });

  it("represents a prepared draft without requiring a durable record", () => {
    const state = deriveToolActivitySections({
      draft: draft(true),
      argumentRegion: "until-result",
    });
    assert.equal(state.phase, "prepared");
    assert.equal(state.resultMode, "none");
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
        deriveToolActivitySections({
          toolCall: toolCall(status),
          argumentRegion: "none",
        }).phase,
        status,
      );
    }
  });

  it("keeps a persistent argument section mounted across the lifecycle", () => {
    const revisions = new Set<string>();
    for (const status of [
      "pending_approval",
      "running",
      "completed",
    ] as const) {
      const state = deriveToolActivitySections({
        draft: draft(true),
        toolCall: toolCall(status),
        argumentRegion: "persistent",
        hasArgumentBody: true,
        hasApproval: status === "pending_approval",
        hasDurableBodyContent: status === "completed",
        resultPlaceholder: { variant: "text", rows: 2 },
        bodyHydrated: true,
      });
      assert.equal(state.argumentVisible, true, status);
      revisions.add(state.structuralRevision);
    }
    // Approval buttons, placeholder, and output are the only structural swaps.
    assert.equal(revisions.size, 3);
  });

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

  it("replaces until-result arguments once result output exists", () => {
    const retained = deriveToolActivitySections({
      draft: draft(true),
      toolCall: toolCall("running"),
      argumentRegion: "until-result",
      hasArgumentBody: true,
      hasDurableBodyContent: false,
      bodyHydrated: true,
    });
    assert.equal(retained.argumentVisible, true);
    assert.equal(retained.resultMode, "none");

    const output = deriveToolActivitySections({
      draft: draft(true),
      toolCall: toolCall("running"),
      argumentRegion: "until-result",
      hasArgumentBody: true,
      hasDurableBodyContent: true,
      bodyHydrated: true,
    });
    assert.equal(output.argumentVisible, false);
    assert.equal(output.resultMode, "output");
    assert.notEqual(retained.structuralRevision, output.structuralRevision);

    const failure = deriveToolActivitySections({
      toolCall: toolCall("error", "boom"),
      argumentRegion: "until-result",
      hasArgumentBody: true,
    });
    assert.equal(failure.argumentVisible, true);
    assert.equal(failure.resultMode, "none");
    assert.equal(failure.errorVisible, true);
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

  it("mounts the approval interaction without hiding arguments", () => {
    const state = deriveToolActivitySections({
      toolCall: toolCall("pending_approval"),
      argumentRegion: "until-result",
      hasArgumentBody: true,
      hasApproval: true,
      footerItems: [{ tone: "warning" }],
    });
    assert.equal(state.interactionMode, "approval");
    assert.equal(state.argumentVisible, true);
    assert.equal(state.resultMode, "none");
    assert.equal(state.footerVisible, false);
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

  it("uses an executing placeholder only for opted-in tools", () => {
    const plain = deriveToolActivitySections({
      toolCall: toolCall("running"),
      argumentRegion: "none",
    });
    assert.equal(plain.resultMode, "none");

    const placeholder = deriveToolActivitySections({
      toolCall: toolCall("running"),
      argumentRegion: "none",
      resultPlaceholder: { variant: "list", rows: 3 },
    });
    assert.equal(placeholder.resultMode, "placeholder");

    const output = deriveToolActivitySections({
      toolCall: toolCall("completed"),
      argumentRegion: "none",
      resultPlaceholder: { variant: "list", rows: 3 },
      hasDurableBodyContent: true,
      bodyHydrated: true,
    });
    assert.equal(output.resultMode, "output");
    assert.notEqual(placeholder.structuralRevision, output.structuralRevision);
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

  it("tracks body hydration without changing for streamed content", () => {
    const hidden = deriveToolActivitySections({
      toolCall: toolCall("running"),
      argumentRegion: "none",
      hasDurableBodyContent: true,
      bodyHydrated: false,
    });
    const visible = deriveToolActivitySections({
      toolCall: toolCall("running"),
      argumentRegion: "none",
      hasDurableBodyContent: true,
      bodyHydrated: true,
    });
    assert.equal(hidden.resultMode, "none");
    assert.equal(visible.resultMode, "output");
    assert.notEqual(hidden.structuralRevision, visible.structuralRevision);
    assert.equal(
      visible.structuralRevision,
      deriveToolActivitySections({
        toolCall: toolCall("completed"),
        argumentRegion: "none",
        hasDurableBodyContent: true,
        bodyHydrated: true,
      }).structuralRevision,
    );
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
