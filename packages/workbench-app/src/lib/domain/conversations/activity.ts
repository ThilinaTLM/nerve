import {
  agentRunningTone,
  type StatusTone,
} from "@nervekit/ui-kit/display/status";
import type { AgentRecord } from "@nervekit/contracts/agents";
import type {
  ApprovalRecord,
  ToolCallTranscriptRecord,
  UserQuestionRecord,
} from "@nervekit/contracts/tools";
import type { ConversationRecord } from "@nervekit/contracts/conversations";
import type { PlanReviewRecord } from "@nervekit/contracts/plans";
import { conversationViewKey } from "$lib/domain/navigation/view-keys";

type ApprovalWithToolCall = ApprovalRecord & {
  toolCall?: ToolCallTranscriptRecord;
};

type ConversationLiveActivity = {
  activeRun?: { status: string };
  transient?: { compaction?: { state: string } };
  sending?: boolean;
};

export type ConversationActivitySource =
  | "pending-input"
  | "agent"
  | "live-view"
  | "none";

export type ConversationActivityIndicator =
  | "idle"
  | "running"
  | "needs-user"
  | "error"
  | "completed";

export type ConversationActivityState = {
  indicator: ConversationActivityIndicator;
  tone: StatusTone;
  pulse: boolean;
  label?: string;
  busy: boolean;
  needsUser: boolean;
  source: ConversationActivitySource;
  clearableFailure?: boolean;
};

export const idleConversationActivity: ConversationActivityState = {
  indicator: "idle",
  tone: "neutral",
  pulse: false,
  busy: false,
  needsUser: false,
  source: "none",
  clearableFailure: false,
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
  view?: ConversationLiveActivity;
  hasPendingHumanInput?: boolean;
  completedAt?: string;
  runtimeStatusClearedAt?: string;
}): ConversationActivityState {
  const pending = Boolean(input.hasPendingHumanInput);
  const failureCleared = Boolean(
    input.runtimeStatusClearedAt &&
    (!input.agent?.updatedAt ||
      input.agent.updatedAt <= input.runtimeStatusClearedAt),
  );
  const waiting = input.view?.activeRun?.status === "waiting";
  const failed =
    input.view?.activeRun?.status === "interrupted" ||
    input.agent?.status === "error";
  if (failed && !failureCleared) {
    return {
      indicator: "error",
      tone: "danger",
      pulse: false,
      label: "Agent error",
      busy: false,
      needsUser: false,
      source:
        input.view?.activeRun?.status === "interrupted" ? "live-view" : "agent",
      clearableFailure: true,
    };
  }
  if (pending || waiting || input.agent?.status === "awaiting_user") {
    return {
      indicator: "needs-user",
      tone: "warn",
      pulse: false,
      label: "Needs user action",
      busy: false,
      needsUser: true,
      source: pending ? "pending-input" : waiting ? "live-view" : "agent",
      clearableFailure: false,
    };
  }

  if (input.view?.transient?.compaction?.state === "running") {
    return {
      indicator: "running",
      tone: "running",
      pulse: true,
      label: "Compacting context",
      busy: true,
      needsUser: false,
      source: "live-view",
      clearableFailure: false,
    };
  }

  if (
    input.agent?.status === "running" ||
    input.view?.sending ||
    (input.view?.activeRun && input.view.activeRun.status !== "interrupted")
  ) {
    return {
      indicator: "running",
      tone: agentRunningTone(input.agent?.mode ?? input.mode),
      pulse: true,
      label: "Agent running",
      busy: true,
      needsUser: false,
      source: input.agent?.status === "running" ? "agent" : "live-view",
      clearableFailure: false,
    };
  }

  if (input.completedAt) {
    return {
      indicator: "completed",
      tone: "neutral",
      pulse: false,
      label: "Completed",
      busy: false,
      needsUser: false,
      source: "none",
      clearableFailure: false,
    };
  }

  return idleConversationActivity;
}

export function buildConversationActivityById(input: {
  conversations: ConversationRecord[];
  agents: AgentRecord[];
  views: Record<string, ConversationLiveActivity>;
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
      completedAt: conversation.completedAt,
      runtimeStatusClearedAt: conversation.runtimeStatusClearedAt,
    });
  }
  return result;
}
