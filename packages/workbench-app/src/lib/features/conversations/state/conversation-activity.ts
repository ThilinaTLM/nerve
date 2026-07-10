import {
  agentRunningTone,
  type StatusTone,
} from "@nervekit/workbench-ui/core/utils/status";
import type {
  AgentRecord,
  ApprovalWithToolCall,
  ConversationRecord,
  PlanReviewRecord,
  UserQuestionRecord,
} from "$lib/api";
import { conversationViewKey } from "$lib/core/state/state-keys";
import type { ConversationViewState } from "$lib/core/types/state-types";

export type ConversationActivitySource =
  | "pending-input"
  | "agent"
  | "live-view"
  | "none";

export type ConversationActivityState = {
  tone: StatusTone;
  pulse: boolean;
  label?: string;
  busy: boolean;
  needsUser: boolean;
  source: ConversationActivitySource;
};

export const idleConversationActivity: ConversationActivityState = {
  tone: "neutral",
  pulse: false,
  busy: false,
  needsUser: false,
  source: "none",
};

export function agentForConversation(
  conversation: ConversationRecord,
  agents: AgentRecord[],
): AgentRecord | undefined {
  return (
    agents.find((agent) => agent.id === conversation.activeAgentId) ??
    agents.find((agent) => agent.conversationId === conversation.id)
  );
}

function hasPendingHumanInput(
  conversationId: string,
  approvals: ApprovalWithToolCall[],
  userQuestions: UserQuestionRecord[],
  planReviews: PlanReviewRecord[],
): boolean {
  return (
    approvals.some(
      (approval) =>
        approval.conversationId === conversationId &&
        approval.status === "pending",
    ) ||
    userQuestions.some(
      (question) =>
        question.conversationId === conversationId &&
        question.status === "pending",
    ) ||
    planReviews.some(
      (review) =>
        review.conversationId === conversationId && review.status === "pending",
    )
  );
}

export function conversationActivityForRecord(input: {
  conversationId: string;
  agent?: AgentRecord;
  mode?: AgentRecord["mode"];
  view?: ConversationViewState;
  hasPendingHumanInput?: boolean;
}): ConversationActivityState {
  const pending = Boolean(input.hasPendingHumanInput);
  if (pending || input.agent?.status === "awaiting_user") {
    return {
      tone: "warn",
      pulse: false,
      label: "Needs user action",
      busy: false,
      needsUser: true,
      source: pending ? "pending-input" : "agent",
    };
  }

  if (input.view?.live.compaction?.state === "running") {
    return {
      tone: "running",
      pulse: true,
      label: "Compacting context",
      busy: true,
      needsUser: false,
      source: "live-view",
    };
  }

  if (
    input.agent?.status === "running" ||
    input.view?.sending ||
    input.view?.activeRun
  ) {
    return {
      tone: agentRunningTone(input.agent?.mode ?? input.mode),
      pulse: true,
      label: "Agent running",
      busy: true,
      needsUser: false,
      source: input.agent?.status === "running" ? "agent" : "live-view",
    };
  }

  if (input.agent?.status === "error") {
    return {
      tone: "danger",
      pulse: false,
      label: "Agent error",
      busy: false,
      needsUser: false,
      source: "agent",
    };
  }

  return idleConversationActivity;
}

export function buildConversationActivityById(input: {
  conversations: ConversationRecord[];
  agents: AgentRecord[];
  views: Record<string, ConversationViewState>;
  approvals: ApprovalWithToolCall[];
  userQuestions: UserQuestionRecord[];
  planReviews: PlanReviewRecord[];
}): Record<string, ConversationActivityState> {
  const result: Record<string, ConversationActivityState> = Object.create(null);
  for (const conversation of input.conversations) {
    const agent = agentForConversation(conversation, input.agents);
    result[conversation.id] = conversationActivityForRecord({
      conversationId: conversation.id,
      agent,
      mode: agent?.mode ?? conversation.mode,
      view: input.views[conversationViewKey(conversation.id)],
      hasPendingHumanInput: hasPendingHumanInput(
        conversation.id,
        input.approvals,
        input.userQuestions,
        input.planReviews,
      ),
    });
  }
  return result;
}
