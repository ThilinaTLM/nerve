import type {
  PlanReviewRecord,
  TodoItem,
  ToolCallTranscriptRecord,
  UserQuestionRecord,
} from "@nervekit/contracts";
import { todoItemsField } from "../tools/views/tool-view-helpers.js";
import { buildConversationRenderProjection } from "./render.js";
import type { ApprovalWithToolCall } from "./tool-types.js";
import type { ConversationRenderState } from "./types.js";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export function currentTodosForAgent(
  toolCalls: ToolCallTranscriptRecord[],
  agentId: string | undefined,
): TodoItem[] {
  if (!agentId) return [];
  let latest: ToolCallTranscriptRecord | undefined;
  for (const call of toolCalls) {
    if (
      call.toolName === "todos_set" &&
      call.status === "completed" &&
      call.agentId === agentId &&
      (!latest || call.updatedAt.localeCompare(latest.updatedAt) >= 0)
    ) {
      latest = call;
    }
  }
  if (!latest) return [];
  const details = asRecord(asRecord(latest.resultPreview).details);
  return (
    todoItemsField(details.todos) ??
    todoItemsField(asRecord(latest.argsPreview).todos) ??
    []
  );
}

export function conversationHasContent(
  state?: ConversationRenderState,
): boolean {
  if (!state) return false;
  const projection = buildConversationRenderProjection(state);
  return projection.timeline.length > 0 || Boolean(projection.streamingText);
}

export function conversationReviewBlocked(input: {
  approvals?: readonly ApprovalWithToolCall[];
  pendingUserQuestions?: readonly UserQuestionRecord[];
  pendingPlanReviews?: readonly PlanReviewRecord[];
}): boolean {
  return Boolean(
    input.approvals?.length ||
    input.pendingUserQuestions?.length ||
    input.pendingPlanReviews?.length,
  );
}

export function conversationBanner(
  state?: ConversationRenderState,
): { tone: "muted" | "warning"; title: string; message?: string } | undefined {
  if (!state) return undefined;
  if (state.readOnly) {
    return {
      tone: "warning",
      title: "Read-only snapshot.",
      message: state.fallbackReason,
    };
  }
  if (state.stale) {
    return {
      tone: "muted",
      title: "Conversation may be stale.",
      message: state.fallbackReason,
    };
  }
  return undefined;
}

export function buildConversationView(state?: ConversationRenderState) {
  const projection = buildConversationRenderProjection(state);
  return {
    ...projection,
    activeRunStatus: state?.activeRun?.status,
    hasContent:
      projection.timeline.length > 0 || Boolean(projection.streamingText),
    queuedPrompts: projection.queuedPrompts,
    banner: conversationBanner(state),
  };
}
