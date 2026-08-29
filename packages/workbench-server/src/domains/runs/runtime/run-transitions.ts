import type { ConversationEntry } from "@nervekit/contracts/conversations";
import type { PromptImage } from "@nervekit/contracts/agents";
import type {
  RunCheckpointRecord,
  RunExecutionRecord,
  RunFailureRecord,
  RunInteractionRecord,
  RunPromptRecord,
  RunPublicEventIntent,
  RunTransitionRecord,
  RunRecord,
} from "@nervekit/contracts/runs";
import type { ToolCallTranscriptRecord } from "@nervekit/contracts/tools";
import {
  RUN_FAILURE_MESSAGE_MAX_LENGTH,
  RUN_STATE_EPOCH,
} from "@nervekit/contracts/runs";
import type { IdPort } from "../../../core/ports/ids.js";
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

export function isTerminalRunStatus(
  status: RunRecord["status"],
): status is Extract<
  RunRecord["status"],
  "completed" | "failed" | "cancelled"
> {
  return TERMINAL_STATUSES.has(status);
}

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

export interface WaitCommand {
  interactionId?: string;
  toolCallId: string;
  interactionOrdinal: number;
  toolCallRevision: number;
  batchToolCallIds?: readonly string[];
  kind: "user_input" | "approval" | "plan_review";
  checkpoint: CheckpointCommand;
}

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
  return {
    stateEpoch: RUN_STATE_EPOCH,
    id: command.interactionId ?? prefixed(command.kind, ids.next()),
    conversationId: run.conversationId,
    agentId: run.agentId,
    projectId: run.projectId,
    runId: run.runId,
    executionId: run.executionId,
    toolCallId: command.toolCallId,
    interactionOrdinal: command.interactionOrdinal,
    toolCallRevision: command.toolCallRevision,
    batchToolCallIds: command.batchToolCallIds
      ? [...command.batchToolCallIds]
      : undefined,
    kind: command.kind,
    status: "pending",
    checkpointId: checkpoint.checkpointId,
    createdAt: now,
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
  continuable = retryable,
): RunFailureRecord {
  return boundedFailure({
    code,
    message: errorMessage(error),
    retryable,
    continuable,
  });
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
