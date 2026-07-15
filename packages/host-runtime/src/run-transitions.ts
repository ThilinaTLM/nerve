import type {
  ConversationEntry,
  PlanReviewRecord,
  PromptImage,
  RunCheckpointRecord,
  RunExecutionRecord,
  RunFailureRecord,
  RunInteractionRecord,
  RunPromptRecord,
  RunPublicEventIntent,
  RunTransitionRecord,
  RunRecord,
  ToolCallTranscriptRecord,
} from "@nervekit/contracts";
import {
  RUN_FAILURE_MESSAGE_MAX_LENGTH,
  RUN_STATE_EPOCH,
} from "@nervekit/contracts";
import type { IdPort } from "./index.js";
import type { RunHydratedState } from "./run-unit-of-work.js";

export const ACTIVE_STATUSES = new Set<RunRecord["status"]>([
  "starting",
  "running",
  "retrying",
  "waiting",
  "suspended",
  "cancellation_requested",
  "cancellation_failed",
  "interrupted",
]);

export const TERMINAL_STATUSES = new Set<RunRecord["status"]>([
  "completed",
  "failed",
  "cancelled",
]);

export interface StartRunCommand {
  conversationId: string;
  agentId: string;
  projectId: string;
  prompt: string;
  images?: PromptImage[];
  runId?: string;
  scopeId?: string;
}

export interface CheckpointCommand {
  boundary: RunCheckpointRecord["boundary"];
  transcriptCursor: number;
  entryIds: string[];
  harnessLeafId: string | null;
  harnessSavePointId: string;
  toolCalls: RunCheckpointRecord["toolCalls"];
  interactionId?: string;
}

export interface WaitForQuestionCommand {
  kind: "question";
  interactionId?: string;
  toolCallId: string;
  prompt: string;
  context?: string;
  placeholder?: string;
  required?: boolean;
  checkpoint: CheckpointCommand;
}

export interface WaitForApprovalCommand {
  kind: "approval";
  interactionId?: string;
  toolCallId: string;
  prompt: string;
  context?: string;
  risk: string[];
  normalizedArgs: Record<string, unknown>;
  offeredScopes: Array<"single_call" | "same_tool_same_args" | "run">;
  checkpoint: CheckpointCommand;
}

export interface WaitForPlanReviewCommand {
  kind: "plan_review";
  interactionId?: string;
  toolCallId: string;
  prompt: string;
  context?: string;
  planReview: PlanReviewRecord;
  checkpoint: CheckpointCommand;
}

export type WaitCommand =
  | WaitForQuestionCommand
  | WaitForApprovalCommand
  | WaitForPlanReviewCommand;

export interface IntegrityPort {
  checksum(value: unknown): string;
}

export function revise(
  run: RunRecord,
  patch: Partial<RunRecord>,
  updatedAt: string,
): RunRecord {
  return { ...run, ...patch, revision: run.revision + 1, updatedAt };
}

export interface TransitionChanges {
  execution?: RunExecutionRecord;
  prompts?: RunPromptRecord[];
  interactions?: RunInteractionRecord[];
  checkpoints?: RunCheckpointRecord[];
  entries?: ConversationEntry[];
  toolCalls?: ToolCallTranscriptRecord[];
  events?: RunPublicEventIntent[];
}

/** Assembles one revision-checked transition and stamps its integrity hash. */
export function buildTransition(
  run: RunRecord,
  kind: string,
  expectedRevision: number,
  changes: TransitionChanges,
  ids: IdPort,
  integrity: IntegrityPort,
): RunTransitionRecord {
  const revision = expectedRevision + 1;
  const base = {
    stateEpoch: RUN_STATE_EPOCH,
    transitionId: prefixed("transition", ids.next()),
    runId: run.runId,
    scopeId: run.scopeId,
    revision,
    previousRevision: expectedRevision,
    kind,
    committedAt: run.updatedAt,
    run: { ...run, revision },
    execution: changes.execution,
    prompts: changes.prompts ?? [],
    interactions: changes.interactions ?? [],
    checkpoints: changes.checkpoints ?? [],
    entries: changes.entries ?? [],
    toolCalls: changes.toolCalls ?? [],
    events: changes.events ?? [],
  };
  return { ...base, checksum: integrity.checksum(base) };
}

export function newRun(
  command: StartRunCommand,
  scopeId: string,
  now: string,
  ids: IdPort,
): RunRecord {
  return {
    stateEpoch: RUN_STATE_EPOCH,
    conversationId: command.conversationId,
    agentId: command.agentId,
    projectId: command.projectId,
    runId: command.runId ?? prefixed("run", ids.next()),
    scopeId,
    revision: 1,
    status: "starting",
    recoverability: "retryable",
    executionId: prefixed("exec", ids.next()),
    attempt: 1,
    createdAt: now,
    updatedAt: now,
    cancellationEvidence: [],
  };
}

export function executionRecord(
  run: RunRecord,
  status: RunExecutionRecord["status"],
  now: string,
): RunExecutionRecord {
  return {
    stateEpoch: RUN_STATE_EPOCH,
    conversationId: run.conversationId,
    agentId: run.agentId,
    projectId: run.projectId,
    runId: run.runId,
    executionId: run.executionId,
    attempt: run.attempt,
    status,
    recoverability: run.recoverability,
    startedAt: run.startedAt ?? run.createdAt,
    completedAt: ["completed", "failed", "cancelled", "superseded"].includes(
      status,
    )
      ? now
      : undefined,
    lastCheckpointId: run.lastCheckpointId,
    failure: run.failure,
  };
}

export function checkpointRecord(
  state: RunHydratedState,
  command: CheckpointCommand,
  now: string,
  ids: IdPort,
  integrity: IntegrityPort,
): RunCheckpointRecord {
  const base = {
    stateEpoch: RUN_STATE_EPOCH,
    checkpointId: prefixed("checkpoint", ids.next()),
    parentCheckpointId: state.run.lastCheckpointId,
    conversationId: state.run.conversationId,
    agentId: state.run.agentId,
    projectId: state.run.projectId,
    runId: state.run.runId,
    executionId: state.run.executionId,
    attempt: state.run.attempt,
    boundary: command.boundary,
    transcriptCursor: command.transcriptCursor,
    entryIds: command.entryIds,
    harnessLeafId: command.harnessLeafId,
    harnessSavePointId: command.harnessSavePointId,
    toolCalls: command.toolCalls,
    interactionId: command.interactionId,
    createdAt: now,
    committed: true as const,
  };
  return { ...base, checksum: integrity.checksum(base) };
}

export function interactionRecord(
  run: RunRecord,
  command: WaitCommand,
  checkpoint: RunCheckpointRecord,
  now: string,
  ids: IdPort,
): RunInteractionRecord {
  const common = {
    stateEpoch: RUN_STATE_EPOCH,
    id: command.interactionId ?? prefixed(command.kind, ids.next()),
    conversationId: run.conversationId,
    agentId: run.agentId,
    projectId: run.projectId,
    runId: run.runId,
    executionId: run.executionId,
    toolCallId: command.toolCallId,
    prompt: command.prompt,
    context: command.context,
    status: "pending" as const,
    checkpointId: checkpoint.checkpointId,
    createdAt: now,
  };
  if (command.kind === "question") {
    return {
      ...common,
      kind: "question",
      placeholder: command.placeholder,
      required: command.required !== false,
    };
  }
  if (command.kind === "approval") {
    return {
      ...common,
      kind: "approval",
      risk: command.risk,
      normalizedArgs: command.normalizedArgs,
      offeredScopes: command.offeredScopes,
    };
  }
  return {
    ...common,
    kind: "plan_review",
    planReview: command.planReview,
  };
}

export function boundedFailure(value: RunFailureRecord): RunFailureRecord {
  return {
    ...value,
    message: value.message.slice(0, RUN_FAILURE_MESSAGE_MAX_LENGTH),
  };
}

export function failure(
  code: string,
  error: unknown,
  retryable: boolean,
): RunFailureRecord {
  return boundedFailure({ code, message: errorMessage(error), retryable });
}

export function prefixed(prefix: string, value: string): string {
  return value.startsWith(`${prefix}_`) ? value : `${prefix}_${value}`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((item, index) => item === right[index])
  );
}

export function checkpointWithoutChecksum(checkpoint: RunCheckpointRecord) {
  const { checksum, ...rest } = checkpoint;
  void checksum;
  return rest;
}
