import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  AgentRecord,
  ApprovalWithToolCall,
  ConversationRecord,
  PlanReviewRecord,
  UserQuestionRecord,
} from "$lib/api";
import { conversationViewKey } from "$lib/core/state/state-keys";
import type { ConversationViewState } from "$lib/core/types/state-types";
import {
  buildConversationActivityById,
  conversationActivityForRecord,
} from "./conversation-activity";

function conversation(id: string, activeAgentId?: string): ConversationRecord {
  return { id, activeAgentId, mode: "coding" } as ConversationRecord;
}

function agent(
  id: string,
  conversationId: string,
  status: AgentRecord["status"],
): AgentRecord {
  return { id, conversationId, status, mode: "coding" } as AgentRecord;
}

function view(
  conversationId: string,
  state: Partial<ConversationViewState>,
): ConversationViewState {
  return { conversationId, ...state } as ConversationViewState;
}

describe("conversation activity", () => {
  it("preserves active-agent precedence over the conversation fallback", () => {
    const result = buildConversationActivityById({
      conversations: [conversation("conversation-1", "active-agent")],
      agents: [
        agent("fallback-agent", "conversation-1", "running"),
        agent("active-agent", "other-conversation", "error"),
      ],
      views: {},
      approvals: [],
      userQuestions: [],
      planReviews: [],
    });

    assert.equal(result["conversation-1"]?.tone, "danger");
    assert.equal(result["conversation-1"]?.source, "agent");
  });

  it("detects pending human input from every input collection", () => {
    const inputs = [
      {
        approvals: [
          { conversationId: "conversation-1", status: "pending" },
        ] as ApprovalWithToolCall[],
        userQuestions: [],
        planReviews: [],
      },
      {
        approvals: [],
        userQuestions: [
          { conversationId: "conversation-1", status: "pending" },
        ] as UserQuestionRecord[],
        planReviews: [],
      },
      {
        approvals: [],
        userQuestions: [],
        planReviews: [
          { conversationId: "conversation-1", status: "pending" },
        ] as PlanReviewRecord[],
      },
    ];

    for (const input of inputs) {
      const result = buildConversationActivityById({
        conversations: [conversation("conversation-1")],
        agents: [],
        views: {},
        ...input,
      });
      assert.equal(result["conversation-1"]?.needsUser, true);
      assert.equal(result["conversation-1"]?.source, "pending-input");
    }
  });

  it("keeps activity priority stable", () => {
    const needsUser = conversationActivityForRecord({
      conversationId: "conversation-1",
      agent: agent("agent-1", "conversation-1", "running"),
      view: view("conversation-1", {
        transient: { compaction: { id: "compaction-1", state: "running" } },
      }),
      hasPendingHumanInput: true,
    });
    assert.equal(needsUser.needsUser, true);

    const compacting = conversationActivityForRecord({
      conversationId: "conversation-1",
      agent: agent("agent-1", "conversation-1", "running"),
      view: view("conversation-1", {
        transient: { compaction: { id: "compaction-1", state: "running" } },
      }),
    });
    assert.equal(compacting.label, "Compacting context");

    const running = conversationActivityForRecord({
      conversationId: "conversation-1",
      agent: agent("agent-1", "conversation-1", "running"),
    });
    assert.equal(running.busy, true);

    const failed = conversationActivityForRecord({
      conversationId: "conversation-1",
      agent: agent("agent-1", "conversation-1", "error"),
    });
    assert.equal(failed.tone, "danger");

    const interrupted = conversationActivityForRecord({
      conversationId: "conversation-1",
      agent: agent("agent-1", "conversation-1", "running"),
      view: view("conversation-1", {
        activeRun: {
          status: "interrupted",
        } as NonNullable<ConversationViewState["activeRun"]>,
      }),
    });
    assert.equal(interrupted.tone, "danger");
    assert.equal(interrupted.pulse, false);
    assert.equal(interrupted.busy, false);

    const idle = conversationActivityForRecord({
      conversationId: "conversation-1",
    });
    assert.equal(idle.source, "none");
  });

  it("projects a larger conversation collection correctly", () => {
    const conversations = Array.from({ length: 200 }, (_, index) =>
      conversation(`conversation-${index}`),
    );
    const views = {
      [conversationViewKey("conversation-199")]: view("conversation-199", {
        sending: true,
      }),
    };
    const result = buildConversationActivityById({
      conversations,
      agents: [],
      views,
      approvals: [],
      userQuestions: [],
      planReviews: [],
    });

    assert.equal(Object.keys(result).length, 200);
    assert.equal(result["conversation-0"]?.source, "none");
    assert.equal(result["conversation-199"]?.busy, true);
  });
});
