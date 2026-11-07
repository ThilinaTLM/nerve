/** Presentation-owned run review shapes. No runtime schemas. */
import type { ToolCallTranscriptRecord } from "./tool-records";
import type { ThinkingLevel, ModelSelection } from "@nervekit/contracts/models";
import type { UserInputQuestion } from "@nervekit/contracts/core";
import type {
  PermissionException,
  PermissionRule,
  ToolRisk,
} from "@nervekit/contracts/permissions";
import type { ApprovalScope } from "./tool-interactions";

export type ApprovalRecord = {
  toolCallId: string;
  agentId: string;
  conversationId: string;
  projectId: string;
  risk?: ToolRisk;
  reason: string;
  status: "denied" | "pending" | "granted";
  requestedAt: string;
  offeredScopes: Extract<
    ApprovalScope,
    "single_call" | "always_conversation" | "always_project" | "always_user"
  >[];
  suggestedExceptions: PermissionException[];
  suggestedRules: PermissionRule[];
  resolvedAt?: string | undefined;
  resolutionNote?: string | undefined;
  permissionRuleSetId?: string | undefined;
};

export type UserQuestionRecord = {
  toolCallId: string;
  agentId: string;
  conversationId: string;
  projectId: string;
  questions: UserInputQuestion[];
  status: "pending" | "answered" | "dismissed";
  requestedAt: string;
  updatedAt: string;
  resolvedAt?: string | undefined;
};

export type RunFailureCategory =
  | "unknown"
  | "provider"
  | "rate_limit"
  | "authentication"
  | "connection"
  | "harness";

export type RecoveryIssue = {
  id: string;
  conversationId: string;
  code:
    | "outcome_unknown"
    | "invalid_checkpoint"
    | "missing_artifact"
    | "conflicting_state"
    | "stale_branch";
  message: string;
  actions: ("inspect" | "cancel_run" | "authorize_retry")[];
  createdAt: string;
  runId?: string | undefined;
  workId?: string | undefined;
  proposalId?: string | undefined;
};

export interface ConversationCompactionFailedData {
  conversationId: string;
  agentId?: string;
  runId?: string;
  reason: ConversationCompactionReason;
  failedAt: string;
  message: string;
  code?: "ineffective" | "stale" | "pending_work" | "no_new_history";
  failedEntryId?: string;
}

export type PlanReviewRecord = {
  targetProfile?: import("@nervekit/contracts/agent-configuration").ProfileTarget;
  id?: string;
  toolCallId: string;
  agentId: string;
  conversationId: string;
  projectId: string;
  slug: string;
  planPath: string;
  status:
    | "pending"
    | "accepted"
    | "accepted_in_new_chat"
    | "changes_requested"
    | "discarded"
    | "force_exited";
  requestedAt: string;
  updatedAt: string;
  title?: string | undefined;
  summary?: string | undefined;
  content?: string | undefined;
  feedback?: string | undefined;
  resolvedAt?: string | undefined;
};

export type ApprovalWithToolCall = ApprovalRecord & {
  toolCall: ToolCallTranscriptRecord;
};

export type PlanReviewResolveOptions = {
  feedback?: string;
  implementationModel?: ModelSelection;
  implementationThinkingLevel?: ThinkingLevel;
  compactBeforeImplementation?: boolean;
};

export type RunStatus =
  | "running"
  | "retrying"
  | "aborting"
  | "waiting"
  | "executing_tools"
  | "interrupted";

export interface ConversationRunRetrySnapshot {
  attempt: number;
  maxRetries: number;
  delayMs: number;
  retryAt: string;
  errorMessage?: string;
  failureCategory?: RunFailureCategory;
  httpStatus?: number;
  failedEntryId?: string;
}

export interface ConversationRunRecoverySnapshot {
  errorMessage?: string;
  failureCategory?: RunFailureCategory;
  httpStatus?: number;
  continuable: boolean;
}

export type ConversationCompactionReason = "manual" | "threshold" | "overflow";
