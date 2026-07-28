import type {
  ConversationEntry,
  PromptImage,
  RunCheckpointRecord,
  RunFailureRecord,
  RunInteractionRecord,
  RunPromptRecord,
  RunRecord,
  ToolCallTranscriptRecord,
} from "@nervekit/contracts";
import type { RunProgressEvent } from "./run-events.js";
import type { CheckpointCommand, WaitCommand } from "./run-transitions.js";

/**
 * The only channel through which a live execution reports durable lifecycle
 * effects. A host execution adapter receives one sink per execution and can
 * never mutate canonical run state directly. Every method routes through the
 * coordinator's revision-checked unit of work.
 */
export interface RunExecutionSink {
  /** Append committed conversation entries produced by the execution. */
  appendEntries(entries: readonly ConversationEntry[]): Promise<void>;
  /** Upsert tool-call transcript revisions for the run. */
  upsertToolCalls(
    toolCalls: readonly ToolCallTranscriptRecord[],
  ): Promise<void>;
  /** Mark a queued user prompt delivered when the execution drains it. */
  promptDelivered(promptId: string): Promise<void>;
  /** Record a provider/tool checkpoint boundary after reference validation. */
  checkpoint(command: CheckpointCommand): Promise<RunCheckpointRecord>;
  /** Enter a typed durable wait (question/approval/plan review). */
  wait(command: WaitCommand): Promise<RunInteractionRecord>;
  /** Atomically enter multiple waits sharing one suspension checkpoint. */
  waitMany(
    commands: readonly WaitCommand[],
  ): Promise<readonly RunInteractionRecord[]>;
  /** Publish a bounded ephemeral progress/delta on the notify port. */
  progress(event: RunProgressEvent): void;
}

/** Live control surface exposed by a running execution to the coordinator. */
export interface RunExecutionControl {
  steer(prompt: RunPromptRecord): Promise<void>;
  followUp(prompt: RunPromptRecord): Promise<void>;
  removeQueuedPrompt(promptId: string): Promise<boolean>;
  continue(): Promise<void>;
  cancel(reason?: string): Promise<void>;
}

export type RunExecutionOutcome =
  | { status: "completed"; result?: Readonly<Record<string, unknown>> }
  | { status: "suspended" }
  | { status: "failed"; failure: RunFailureRecord }
  | { status: "interrupted"; message: string };

export interface RunExecution {
  readonly control: RunExecutionControl;
  execute(input: {
    run: RunRecord;
    command: "start" | "continue";
    prompt?: string;
    images?: PromptImage[];
    signal: AbortSignal;
  }): Promise<RunExecutionOutcome>;
}

/**
 * Constructs the real harness-backed execution. The sink is supplied at
 * construction so the adapter can report durable effects, but the adapter
 * cannot take lifecycle ownership.
 */
export interface RunExecutionFactoryPort {
  create(run: RunRecord, sink: RunExecutionSink): Promise<RunExecution>;
}

export interface RunCancellationPort {
  cancelModel(run: RunRecord): Promise<"confirmed" | "not_running">;
  cancelTools(run: RunRecord): Promise<"confirmed" | "not_running">;
  cancelTasks(run: RunRecord): Promise<"confirmed" | "not_running">;
  cancelSubagents(run: RunRecord): Promise<"confirmed" | "not_running">;
  cancelInteraction(run: RunRecord): Promise<"confirmed" | "not_running">;
}

export interface RunIntegrityPort {
  checksum(value: unknown): string;
}

interface LiveExecution {
  readonly execution: RunExecution;
  readonly abort: AbortController;
  readonly promise: Promise<void>;
}

/**
 * Non-authoritative registry of currently live executions. Used only to wake
 * or cancel a running execution; run status, waits, prompts, and recovery are
 * always sourced from canonical transition state.
 */
export class LiveExecutionRegistry {
  private readonly executions = new Map<string, LiveExecution>();

  set(runId: string, value: LiveExecution): void {
    this.executions.set(runId, value);
  }

  get(runId: string): LiveExecution | undefined {
    return this.executions.get(runId);
  }

  delete(runId: string, execution?: RunExecution): void {
    if (execution && this.executions.get(runId)?.execution !== execution)
      return;
    this.executions.delete(runId);
  }
}
