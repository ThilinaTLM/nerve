import {
  agentRunningTone,
  type StatusTone,
} from "@nervekit/ui-kit/core/utils/status";
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

export function conversationActivityForRecord(input: {
  conversationId: string;
  agent?: AgentRecord;
  mode?: AgentRecord["mode"];
  view?: ConversationViewState;
  hasPendingHumanInput?: boolean;
}): ConversationActivityState {
  const pending = Boolean(input.hasPendingHumanInput);
  const waiting = input.view?.activeRun?.status === "waiting";
  if (pending || waiting || input.agent?.status === "awaiting_user") {
    return {
      tone: "warn",
      pulse: false,
      label: "Needs user action",
      busy: false,
      needsUser: true,
      source: pending ? "pending-input" : waiting ? "live-view" : "agent",
    };
  }

  if (input.view?.transient?.compaction?.state === "running") {
    return {
      tone: "running",
      pulse: true,
      label: "Compacting context",
      busy: true,
      needsUser: false,
      source: "live-view",
    };
  }

  if (input.view?.activeRun?.status === "interrupted") {
    return {
      tone: "danger",
      pulse: false,
      label: "Agent error",
      busy: false,
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
  const agentsById = new Map<string, AgentRecord>();
  const agentsByConversationId = new Map<string, AgentRecord>();
  for (const agent of input.agents) {
    agentsById.set(agent.id, agent);
    if (
      agent.conversationId &&
      !agentsByConversationId.has(agent.conversationId)
    ) {
      agentsByConversationId.set(agent.conversationId, agent);
    }
  }

  const pendingConversationIds = new Set<string>();
  for (const approval of input.approvals) {
    if (approval.status === "pending") {
      pendingConversationIds.add(approval.conversationId);
    }
  }
  for (const question of input.userQuestions) {
    if (question.status === "pending") {
      pendingConversationIds.add(question.conversationId);
    }
  }
  for (const review of input.planReviews) {
    if (review.status === "pending") {
      pendingConversationIds.add(review.conversationId);
    }
  }

  const result: Record<string, ConversationActivityState> = Object.create(null);
  for (const conversation of input.conversations) {
    const agent =
      (conversation.activeAgentId
        ? agentsById.get(conversation.activeAgentId)
        : undefined) ?? agentsByConversationId.get(conversation.id);
    result[conversation.id] = conversationActivityForRecord({
      conversationId: conversation.id,
      agent,
      mode: agent?.mode ?? conversation.mode,
      view: input.views[conversationViewKey(conversation.id)],
      hasPendingHumanInput: pendingConversationIds.has(conversation.id),
    });
  }
  return result;
}
