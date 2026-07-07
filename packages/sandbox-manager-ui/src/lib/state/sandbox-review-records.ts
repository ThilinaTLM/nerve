import type {
  ApprovalWithToolCall,
  ConversationRenderState,
  UserQuestionRecord,
} from "@nervekit/conversation-ui/state";
import type { ToolRisk } from "@nervekit/shared";
import type { SandboxDetailState } from "./sandbox-ui-types";

// Placeholder ids for the required record fields the sandbox transcript does not
// carry per-wait. The shared transcript components only use these for matching
// (`toolCallId`) and callback round-tripping (`id`); the concrete agent/
// conversation/project ids are display-irrelevant here.
const FALLBACK_AGENT_ID = "agent_sandbox";
const FALLBACK_CONVERSATION_ID = "conv_sandbox";
const FALLBACK_PROJECT_ID = "proj_sandbox";

function toolRisk(risks: string[] | undefined): ToolRisk {
  return (risks?.[0] as ToolRisk | undefined) ?? "workspace_write";
}

/**
 * Build the inline approval prompts rendered by `TranscriptList`. The sandbox
 * `ConversationSnapshot` does not carry approval/question records, so they are
 * reconstructed from the live `waitsById` reducer state. The wait id equals the
 * daemon's `approvalId` (and the tool-call id), so it round-trips cleanly
 * through `resolveApproval` and matches the pending tool-call card.
 */
export function pendingApprovalRecords(
  detail: SandboxDetailState | undefined,
  richState: ConversationRenderState | undefined,
): ApprovalWithToolCall[] {
  if (!detail) return [];
  const toolCalls = richState?.toolCalls ?? [];
  return Object.values(detail.waitsById)
    .filter((wait) => wait.kind === "approval" && wait.status === "waiting")
    .map((wait) => {
      const toolCallId = wait.toolCallId ?? wait.waitId;
      return {
        id: wait.waitId,
        toolCallId,
        agentId: detail.selectedAgentId ?? FALLBACK_AGENT_ID,
        conversationId:
          detail.selectedConversationId ?? FALLBACK_CONVERSATION_ID,
        projectId: FALLBACK_PROJECT_ID,
        risk: toolRisk(wait.risks),
        reason:
          wait.reason ?? "Approval required before the agent can continue.",
        status: "pending",
        requestedAt: wait.createdAt,
        toolCall: toolCalls.find((call) => call.id === toolCallId),
      } satisfies ApprovalWithToolCall;
    });
}

/**
 * Build the single pending ask-user question rendered by `TranscriptList`. As
 * with approvals, this is reconstructed from `waitsById`; the wait id equals the
 * daemon's `requestId` (and the ask-user tool-call id).
 */
export function pendingUserQuestionRecord(
  detail: SandboxDetailState | undefined,
): UserQuestionRecord | undefined {
  if (!detail) return undefined;
  const wait = Object.values(detail.waitsById).find(
    (candidate) => candidate.kind === "input" && candidate.status === "waiting",
  );
  if (!wait) return undefined;
  return {
    id: wait.waitId,
    toolCallId: wait.toolCallId ?? wait.waitId,
    agentId: detail.selectedAgentId ?? FALLBACK_AGENT_ID,
    conversationId: detail.selectedConversationId ?? FALLBACK_CONVERSATION_ID,
    projectId: FALLBACK_PROJECT_ID,
    question: wait.question?.text ?? "The agent is waiting for your input.",
    status: "pending",
    requestedAt: wait.createdAt,
    updatedAt: wait.createdAt,
  } satisfies UserQuestionRecord;
}
