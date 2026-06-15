import type {
  AgentRecord,
  ApprovalRecord,
  ApprovalWithToolCall,
  ConversationRecord,
  EventEnvelope,
  PlanReviewRecord,
  ToolCallRecord,
  UserQuestionRecord,
} from "../../api";
import { upsertAgentByUpdatedAt } from "../agent-freshness";
import { workbenchState } from "./state.svelte";

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
  const index = workbenchState.conversations.findIndex(
    (candidate) => candidate.id === conversation.id,
  );
  workbenchState.conversations =
    index === -1
      ? [conversation, ...workbenchState.conversations]
      : workbenchState.conversations.map((candidate) =>
          candidate.id === conversation.id ? conversation : candidate,
        );
}

export function removeConversationRecord(conversationId: string): void {
  workbenchState.conversations = workbenchState.conversations.filter(
    (conversation) => conversation.id !== conversationId,
  );
}

export function upsertAgentRecordFresh(agent: AgentRecord): void {
  workbenchState.agents = upsertAgentByUpdatedAt(agent, workbenchState.agents);
}

export function patchKnownAgentStatus(
  agentId: string | undefined,
  status: AgentRecord["status"],
  updatedAt: string,
): void {
  if (!agentId) return;
  const existing = workbenchState.agents.find((agent) => agent.id === agentId);
  if (!existing || existing.updatedAt > updatedAt) return;
  upsertAgentRecordFresh({ ...existing, status, updatedAt });
}

export function upsertApproval(approval: ApprovalWithToolCall): void {
  if (approval.status !== "pending") {
    removeApproval(approval.id);
    return;
  }
  const index = workbenchState.approvals.findIndex(
    (candidate) => candidate.id === approval.id,
  );
  workbenchState.approvals =
    index === -1
      ? [approval, ...workbenchState.approvals]
      : workbenchState.approvals.map((candidate) =>
          candidate.id === approval.id
            ? { ...candidate, ...approval }
            : candidate,
        );
}

export function removeApproval(approvalId: string): void {
  workbenchState.approvals = workbenchState.approvals.filter(
    (approval) => approval.id !== approvalId,
  );
}

export function upsertUserQuestion(question: UserQuestionRecord): void {
  if (question.status !== "pending") {
    removeUserQuestion(question.id);
    return;
  }
  const index = workbenchState.userQuestions.findIndex(
    (candidate) => candidate.id === question.id,
  );
  workbenchState.userQuestions =
    index === -1
      ? [question, ...workbenchState.userQuestions]
      : workbenchState.userQuestions.map((candidate) =>
          candidate.id === question.id ? question : candidate,
        );
}

export function removeUserQuestion(questionId: string): void {
  workbenchState.userQuestions = workbenchState.userQuestions.filter(
    (question) => question.id !== questionId,
  );
}

export function upsertPlanReview(review: PlanReviewRecord): void {
  if (review.status !== "pending") {
    removePlanReview(review.id);
    return;
  }
  const index = workbenchState.planReviews.findIndex(
    (candidate) => candidate.id === review.id,
  );
  workbenchState.planReviews =
    index === -1
      ? [review, ...workbenchState.planReviews]
      : workbenchState.planReviews.map((candidate) =>
          candidate.id === review.id ? review : candidate,
        );
}

export function removePlanReview(reviewId: string): void {
  workbenchState.planReviews = workbenchState.planReviews.filter(
    (review) => review.id !== reviewId,
  );
}

export function removePlanReviewsForAgent(agentId: string): void {
  workbenchState.planReviews = workbenchState.planReviews.filter(
    (review) => review.agentId !== agentId,
  );
}

export function applyEntityEvent(
  event: EventEnvelope<Record<string, unknown>>,
): void {
  const data = event.data ?? {};
  const agent = recordValue(data.agent);
  const conversation = recordValue(data.conversation);
  const approval = recordValue(data.approval);
  const question = recordValue(data.question);
  const planReview = recordValue(data.planReview);

  if (isConversationRecord(conversation))
    upsertConversationRecord(conversation);
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
