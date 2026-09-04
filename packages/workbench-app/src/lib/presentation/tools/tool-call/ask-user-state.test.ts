import type {
  ToolCallTranscriptRecord,
  UserQuestionRecord,
} from "@nervekit/contracts/tools";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveAskUserQuestion } from "./ask-user-state";

const requestedAt = "2026-09-04T20:49:00.000Z";
const updatedAt = "2026-09-04T20:49:01.000Z";

function askUserToolCall(
  interaction: ToolCallTranscriptRecord["interactions"][number] = {
    kind: "user_input",
    ordinal: 0,
    status: "pending",
    requestedAt,
    updatedAt,
    request: {
      question: "Which scope should this support?",
      context: "Local deletion is safer.",
      recommendation: "Support local branches first.",
      required: true,
    },
  },
): NonNullable<Parameters<typeof resolveAskUserQuestion>[0]> {
  return {
    id: "tool_ask",
    agentId: "agent_main",
    conversationId: "conv_main",
    projectId: "proj_main",
    toolName: "ask_user",
    status: "waiting",
    interactions: [interaction],
  };
}

describe("resolveAskUserQuestion", () => {
  it("prefers a matching pending workspace projection", () => {
    const projected: UserQuestionRecord = {
      id: "question_tool_ask_0",
      toolCallId: "tool_ask",
      agentId: "agent_main",
      conversationId: "conv_main",
      projectId: "proj_main",
      question: "Projected question",
      status: "pending",
      requestedAt,
      updatedAt,
    };

    assert.equal(
      resolveAskUserQuestion(askUserToolCall(), projected),
      projected,
    );
  });

  it("derives the pending question from the durable interaction during handoff", () => {
    assert.deepEqual(resolveAskUserQuestion(askUserToolCall(), undefined), {
      id: "question_tool_ask_0",
      toolCallId: "tool_ask",
      agentId: "agent_main",
      conversationId: "conv_main",
      projectId: "proj_main",
      question: "Which scope should this support?",
      context: "Local deletion is safer.",
      recommendation: "Support local branches first.",
      status: "pending",
      requestedAt,
      updatedAt,
    });
  });

  it("does not expose controls for settled or non-user-input interactions", () => {
    const resolved = askUserToolCall({
      kind: "user_input",
      ordinal: 0,
      status: "resolved",
      requestedAt,
      updatedAt,
      resolvedAt: updatedAt,
      request: {
        question: "Continue?",
        required: true,
      },
      resolution: { action: "answer", answer: "Yes" },
    });
    const approval = askUserToolCall({
      kind: "approval",
      ordinal: 0,
      status: "pending",
      requestedAt,
      updatedAt,
      request: {
        risk: "workspace_write",
        reason: "Needs approval",
        offeredScopes: ["single_call"],
        suggestedExceptions: [],
        suggestedRules: [],
      },
    });

    assert.equal(resolveAskUserQuestion(resolved, undefined), undefined);
    assert.equal(resolveAskUserQuestion(approval, undefined), undefined);
    assert.equal(
      resolveAskUserQuestion(
        { ...askUserToolCall(), status: "completed" },
        undefined,
      ),
      undefined,
    );
  });
});
