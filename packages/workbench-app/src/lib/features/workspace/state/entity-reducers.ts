import type {
  AgentRecord,
  ApprovalRecord,
  ApprovalWithToolCall,
  ConversationEntry,
  ConversationRecord,
  EventEnvelope,
  PlanReviewRecord,
  ToolCallRecord,
  UserQuestionRecord,
} from "$lib/api";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";
import { upsertAgentByUpdatedAt } from "./agent-freshness";

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isAgentRecord(value: unknown): value is AgentRecord {
  const candidate = recordValue(value);
  return Boolean(
    candidate &&
    typeof candidate.id === "string" &&
    typeof candidate.updatedAt === "string",
  );
}

function isConversationRecord(value: unknown): value is ConversationRecord {
  const candidate = recordValue(value);
  return Boolean(
    candidate &&
    typeof candidate.id === "string" &&
    typeof candidate.projectId === "string" &&
    typeof candidate.updatedAt === "string",
  );
}

function isApprovalRecord(value: unknown): value is ApprovalRecord {
  const candidate = recordValue(value);
  return Boolean(
    candidate &&
    typeof candidate.id === "string" &&
    typeof candidate.conversationId === "string" &&
    typeof candidate.status === "string",
  );
}

function isConversationEntry(value: unknown): value is ConversationEntry {
  const candidate = recordValue(value);
  return Boolean(
    candidate &&
    typeof candidate.id === "string" &&
    typeof candidate.conversationId === "string" &&
    typeof candidate.role === "string" &&
    typeof candidate.createdAt === "string",
  );
}

function isUserQuestionRecord(value: unknown): value is UserQuestionRecord {
  const candidate = recordValue(value);
  return Boolean(
    candidate &&
    typeof candidate.id === "string" &&
    typeof candidate.conversationId === "string" &&
    typeof candidate.status === "string" &&
    typeof candidate.updatedAt === "string",
  );
}

function isPlanReviewRecord(value: unknown): value is PlanReviewRecord {
  const candidate = recordValue(value);
  return Boolean(
    candidate &&
    typeof candidate.id === "string" &&
    typeof candidate.conversationId === "string" &&
    typeof candidate.status === "string" &&
    typeof candidate.updatedAt === "string",
  );
}

function isToolCallRecord(value: unknown): value is ToolCallRecord {
  const candidate = recordValue(value);
  return Boolean(candidate && typeof candidate.id === "string");
}

export function upsertConversationRecord(
  conversation: ConversationRecord,
): void {
  const index = workspaceState.conversations.findIndex(
    (candidate) => candidate.id === conversation.id,
  );
  workspaceState.conversations =
    index === -1
      ? [conversation, ...workspaceState.conversations]
      : workspaceState.conversations.map((candidate) =>
          candidate.id === conversation.id ? conversation : candidate,
        );
}

export function removeConversationRecord(conversationId: string): void {
  workspaceState.conversations = workspaceState.conversations.filter(
    (conversation) => conversation.id !== conversationId,
  );
}

export function patchConversationForEntry(entry: ConversationEntry): void {
  const index = workspaceState.conversations.findIndex(
    (candidate) => candidate.id === entry.conversationId,
  );
  if (index === -1) return;
  const current = workspaceState.conversations[index];
  if (!current) return;
  const lastUserMessageAt =
    entry.role === "user" &&
    (!current.lastUserMessageAt || entry.createdAt > current.lastUserMessageAt)
      ? entry.createdAt
      : current.lastUserMessageAt;
  workspaceState.conversations = workspaceState.conversations.map((candidate) =>
    candidate.id === entry.conversationId
      ? {
          ...candidate,
          activeEntryId: entry.id,
          updatedAt: entry.createdAt,
          lastUserMessageAt,
        }
      : candidate,
  );
}

export function upsertAgentRecordFresh(agent: AgentRecord): void {
  workspaceState.agents = upsertAgentByUpdatedAt(agent, workspaceState.agents);
}

export function patchKnownAgentStatus(
  agentId: string | undefined,
  status: AgentRecord["status"],
  updatedAt: string,
): void {
  if (!agentId) return;
  const existing = workspaceState.agents.find((agent) => agent.id === agentId);
  if (!existing || existing.updatedAt > updatedAt) return;
  upsertAgentRecordFresh({ ...existing, status, updatedAt });
}

export function upsertApproval(approval: ApprovalWithToolCall): void {
  if (approval.status !== "pending") {
    removeApproval(approval.id);
    return;
  }
  const index = workspaceState.approvals.findIndex(
    (candidate) => candidate.id === approval.id,
  );
  workspaceState.approvals =
    index === -1
      ? [approval, ...workspaceState.approvals]
      : workspaceState.approvals.map((candidate) =>
          candidate.id === approval.id
            ? { ...candidate, ...approval }
            : candidate,
        );
}

export function removeApproval(approvalId: string): void {
  workspaceState.approvals = workspaceState.approvals.filter(
    (approval) => approval.id !== approvalId,
  );
}

export function upsertUserQuestion(question: UserQuestionRecord): void {
  if (question.status !== "pending") {
    removeUserQuestion(question.id);
    return;
  }
  const index = workspaceState.userQuestions.findIndex(
    (candidate) => candidate.id === question.id,
  );
  workspaceState.userQuestions =
    index === -1
      ? [question, ...workspaceState.userQuestions]
      : workspaceState.userQuestions.map((candidate) =>
          candidate.id === question.id ? question : candidate,
        );
}

export function removeUserQuestion(questionId: string): void {
  workspaceState.userQuestions = workspaceState.userQuestions.filter(
    (question) => question.id !== questionId,
  );
}

export function upsertPlanReview(review: PlanReviewRecord): void {
  if (review.status !== "pending") {
    removePlanReview(review.id);
    return;
  }
  const index = workspaceState.planReviews.findIndex(
    (candidate) => candidate.id === review.id,
  );
  workspaceState.planReviews =
    index === -1
      ? [review, ...workspaceState.planReviews]
      : workspaceState.planReviews.map((candidate) =>
          candidate.id === review.id ? review : candidate,
        );
}

export function removePlanReview(reviewId: string): void {
  workspaceState.planReviews = workspaceState.planReviews.filter(
    (review) => review.id !== reviewId,
  );
}

export function removePlanReviewsForAgent(agentId: string): void {
  workspaceState.planReviews = workspaceState.planReviews.filter(
    (review) => review.agentId !== agentId,
  );
}

export function applyEntityEvent(
  event: EventEnvelope<Record<string, unknown>>,
): void {
  const data = event.data ?? {};
  const agent = recordValue(data.agent);
  const conversation = recordValue(data.conversation);
  const entry = recordValue(data.entry);
  const approval = recordValue(data.approval);
  const question = recordValue(data.question);
  const planReview = recordValue(data.planReview);

  if (isConversationRecord(conversation))
    upsertConversationRecord(conversation);
  if (
    event.type === "conversation.entry.appended" &&
    isConversationEntry(entry)
  )
    patchConversationForEntry(entry);
  if (event.type === "conversation.deleted") {
    const conversationId =
      stringValue(data.conversationId) ?? stringValue(data.id);
    if (conversationId) removeConversationRecord(conversationId);
  }

  if (isAgentRecord(agent)) upsertAgentRecordFresh(agent);

  if (isApprovalRecord(approval)) {
    const toolCall = isToolCallRecord(data.toolCall)
      ? data.toolCall
      : undefined;
    upsertApproval({ ...approval, toolCall });
  }

  if (isUserQuestionRecord(question)) upsertUserQuestion(question);
  if (isPlanReviewRecord(planReview)) upsertPlanReview(planReview);

  if (event.type === "plan_review.force_exited") {
    const agentId = stringValue(data.agentId);
    if (agentId) removePlanReviewsForAgent(agentId);
  }
}
