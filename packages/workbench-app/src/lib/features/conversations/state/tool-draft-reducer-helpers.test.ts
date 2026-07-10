import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LiveToolCallDraft } from "$lib/core/types/state-types";
import { removeDiscardedToolDraft } from "./tool-draft-reducer-helpers";

function draft(key: string, providerToolCallId?: string): LiveToolCallDraft {
  return {
    kind: "tool_call_draft",
    key,
    runId: "run_01H00000000000000000000000",
    conversationId: "conv_01H00000000000000000000000",
    contentIndex: 0,
    providerToolCallId,
    toolName: "grep",
    argsText: '{"pattern":"unterminated',
    done: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
  };
}

describe("tool draft reducer helpers", () => {
  it("removes discarded live tool drafts by key or provider id", () => {
    const kept = draft("live:msg_2:tool-draft:0", "call_kept");
    const drafts = [
      draft("live:msg_1:tool-draft:0", "call_broken"),
      draft("live:msg_1:tool-draft:1", "call_broken"),
      kept,
    ];

    assert.deepEqual(
      removeDiscardedToolDraft(
        drafts,
        "live:msg_1:tool-draft:0",
        "call_broken",
      ),
      [kept],
    );
  });
});
