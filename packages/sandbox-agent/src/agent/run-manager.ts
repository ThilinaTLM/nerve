import type {
  ArtifactRef,
  ConversationEntry,
  SandboxRunStatus,
  StructuredLogger,
} from "@nervekit/contracts";
import { createNoopLogger } from "@nervekit/contracts";
import { Redactor } from "../security/redaction.js";
import type { EventOutbox } from "../state/event-outbox.js";
import {
  type RunCheckpointKind,
  RunCheckpointStore,
} from "./checkpoint-store.js";
import { RunExecutionStore } from "./run-execution-store.js";
import type { RunState, RunStateStore } from "./run-state-store.js";
import { ToolCallStore } from "./tool-call-store.js";
import { TranscriptStore } from "./transcript-store.js";

export type RunScope = {
  conversationId: string;
  agentId: string;
  runId: string;
};

const NOOP_LOGGER = createNoopLogger();

export class RunManager {
  private counter = 0;
  private readonly transcript: TranscriptStore;
  private readonly executions: RunExecutionStore;
  private readonly tools: ToolCallStore;
  private readonly checkpoints: RunCheckpointStore;
  private readonly redactor: Redactor;
  constructor(
    private readonly store: RunStateStore,
    stateDir: string,
    private readonly events?: EventOutbox,
    redactor = new Redactor({ secrets: [] }),
    private readonly commonData: Record<string, unknown> = {},
    private readonly logger: StructuredLogger = NOOP_LOGGER,
  ) {
    this.transcript = new TranscriptStore(stateDir);
    this.executions = new RunExecutionStore(stateDir);
    this.tools = new ToolCallStore(stateDir);
    this.checkpoints = new RunCheckpointStore(stateDir);
    this.redactor = redactor;
  }

  private runLog(scope: {
    conversationId: string;
    agentId: string;
    runId: string;
  }): StructuredLogger {
    return this.logger.child({
      conversationId: scope.conversationId,
      agentId: scope.agentId,
      runId: scope.runId,
    });
  }

  async createRun(input: {
    commandId?: string;
    conversationId?: string;
    agentId?: string;
    prompt?: string;
    behavior?: "start" | "follow_up" | "steer";
    appendUserEntry?: boolean;
    mode?: "coding" | "planning";
  }): Promise<{ run: RunState; executionId: string }> {
    const now = new Date().toISOString();
    // Only accept a well-formed conversation id; anything else (e.g. a UI
    // placeholder like "default") would violate the `conv_` protocol schema and
    // crash the agent when it later encodes outbound events.
    const conversationId = input.conversationId?.startsWith("conv_")
      ? input.conversationId
      : `conv_${Date.now()}`;
    const agentId = input.agentId ?? "agent_main";
    const runId = `run_${Date.now()}_${++this.counter}`;
    const executionId = `exec_${Date.now()}_${this.counter}`;
    const state: RunState = {
      conversationId,
      agentId,
      runId,
      commandId: input.commandId,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      prompt: input.prompt ? this.redactor.redactText(input.prompt) : undefined,
      behavior: input.behavior ?? "start",
      mode: input.mode,
      executionId,
    };
    await this.store.write(state);
    await this.executions.write({
      conversationId,
      agentId,
      runId,
      executionId,
      attempt: 1,
      recoverability: "retryable",
      status: "starting",
      startedAt: now,
    });
    if (input.prompt && input.appendUserEntry !== false) {
      await this.appendTranscriptEntry(state, {
        entryId: `entry_${Date.now()}_0`,
        index: 0,
        role: "user",
        content: { text: this.redactor.redactText(input.prompt) },
        createdAt: now,
      });
    }
    this.runLog(state).debug("run created", {
      behavior: state.behavior,
    });
    return { run: state, executionId };
  }

  async markRunning(
    scope: RunScope & { executionId: string; commandId?: string },
    model: { provider: string; model: string; thinkingLevel?: string },
  ): Promise<RunState> {
    const now = new Date().toISOString();
    const current = await this.require(scope);
    const attempt = await this.attemptFor(scope);
    const next = {
      ...current,
      status: "running",
      updatedAt: now,
      executionId: scope.executionId,
    };
    await this.store.write(next);
    await this.executions.write({
      conversationId: scope.conversationId,
      agentId: scope.agentId,
      runId: scope.runId,
      executionId: scope.executionId,
      attempt,
      recoverability: "retryable",
      status: "streaming",
      startedAt: String(current.createdAt ?? now),
      lastDeltaAt: now,
    });
    await this.events?.append({
      type: "run.started",
      durability: "durable",
      conversationId: scope.conversationId,
      agentId: scope.agentId,
      runId: scope.runId,
      data: {
        ...this.commonData,
        conversationId: scope.conversationId,
        agentId: scope.agentId,
        runId: scope.runId,
        commandId:
          scope.commandId ?? String(current.commandId ?? "cmd_unknown"),
        status: "running",
        promptSummary:
          typeof current.prompt === "string"
            ? current.prompt.slice(0, 120)
            : undefined,
        mode: current.mode,
        model,
        startedAt: now,
      },
    });
    this.runLog(scope).debug("run running", {
      provider: model.provider,
      model: model.model,
    });
    return next;
  }

  async markWaiting(
    scope: RunScope & { executionId?: string },
    kind: "input" | "approval" | "plan_review",
    data: Record<string, unknown>,
  ): Promise<RunState> {
    const now = new Date().toISOString();
    const current = await this.require(scope);
    const status =
      kind === "approval" ? "waiting_for_approval" : "waiting_for_input";
    const next = {
      ...current,
      status,
      updatedAt: now,
      wait: data,
      lastCheckpointId:
        typeof data.checkpointId === "string"
          ? data.checkpointId
          : current.lastCheckpointId,
    };
    await this.store.write(next);
    if (scope.executionId) {
      const attempt = await this.attemptFor({
        ...scope,
        executionId: scope.executionId,
      });
      await this.executions.write({
        conversationId: scope.conversationId,
        agentId: scope.agentId,
        runId: scope.runId,
        executionId: scope.executionId,
        attempt,
        recoverability: "checkpoint",
        status: "waiting",
        startedAt: String(current.createdAt ?? now),
        lastCheckpointId:
          typeof data.checkpointId === "string" ? data.checkpointId : undefined,
      });
    }
    await this.events?.append({
      type:
        kind === "input"
          ? "run.waiting_for_input"
          : kind === "plan_review"
            ? "run.waiting_for_plan_review"
            : "run.waiting_for_approval",
      durability: "durable",
      conversationId: scope.conversationId,
      agentId: scope.agentId,
      runId: scope.runId,
      data: {
        ...this.commonData,
        conversationId: scope.conversationId,
        agentId: scope.agentId,
        runId: scope.runId,
        ...data,
      },
    });
    this.runLog(scope).debug("run waiting", { kind });
    return next;
  }

  async markCompleted(
    scope: RunScope & { executionId?: string },
  ): Promise<RunState> {
    const now = new Date().toISOString();
    const current = await this.require(scope);
    if (scope.executionId)
      await this.writeCheckpoint(scope, "terminal", {
        status: "completed",
        executionId: scope.executionId,
        summary: { text: "run completed" },
      });
    const attempt = scope.executionId
      ? await this.attemptFor({ ...scope, executionId: scope.executionId })
      : 1;
    const next = {
      ...current,
      status: "completed",
      updatedAt: now,
      terminalAt: now,
    };
    if (scope.executionId)
      await this.executions.write({
        conversationId: scope.conversationId,
        agentId: scope.agentId,
        runId: scope.runId,
        executionId: scope.executionId,
        attempt,
        recoverability: "retryable",
        status: "completed",
        startedAt: String(current.createdAt ?? now),
        completedAt: now,
      });
    await this.events?.append({
      type: "run.completed",
      durability: "durable",
      conversationId: scope.conversationId,
      agentId: scope.agentId,
      runId: scope.runId,
      data: {
        ...this.commonData,
        conversationId: scope.conversationId,
        agentId: scope.agentId,
        runId: scope.runId,
        status: "completed",
        completedAt: now,
      },
    });
    await this.store.write(next);
    this.runLog(scope).info("run completed", {});
    return next;
  }

  async markFailed(
    scope: RunScope & { executionId?: string },
    error: { code: string; message: string; retryable?: boolean },
    recoverable = false,
  ): Promise<RunState> {
    const now = new Date().toISOString();
    const current = await this.require(scope);
    if (scope.executionId)
      await this.writeCheckpoint(scope, "terminal", {
        status: recoverable ? "recoverable_failed" : "failed",
        executionId: scope.executionId,
        recoverable,
        summary: { text: error.message.slice(0, 500) },
      });
    const attempt = scope.executionId
      ? await this.attemptFor({ ...scope, executionId: scope.executionId })
      : 1;
    const next = {
      ...current,
      status: recoverable ? "recoverable_failed" : "failed",
      updatedAt: now,
      terminalAt: recoverable ? undefined : now,
      error: this.redactor.redact(error),
    };
    if (scope.executionId)
      await this.executions.write({
        conversationId: scope.conversationId,
        agentId: scope.agentId,
        runId: scope.runId,
        executionId: scope.executionId,
        attempt,
        recoverability: error.retryable ? "retryable" : "none",
        status: "failed",
        startedAt: String(current.createdAt ?? now),
        completedAt: now,
        error,
      });
    await this.events?.append({
      type: "run.failed",
      durability: "durable",
      conversationId: scope.conversationId,
      agentId: scope.agentId,
      runId: scope.runId,
      data: {
        ...this.commonData,
        conversationId: scope.conversationId,
        agentId: scope.agentId,
        runId: scope.runId,
        status: "failed",
        failedAt: now,
        error,
      },
    });
    await this.store.write(next);
    this.runLog(scope).warn("run failed", {
      code: error.code,
      recoverable,
    });
    return next;
  }

  async cancel(
    scope: RunScope & { reason?: string; executionId?: string },
  ): Promise<RunState> {
    const current = await this.require(scope);
    const now = new Date().toISOString();
    if (scope.executionId)
      await this.writeCheckpoint(scope, "terminal", {
        status: "cancelled",
        executionId: scope.executionId,
        summary: { text: scope.reason ?? "run cancelled" },
      });
    const attempt = scope.executionId
      ? await this.attemptFor({ ...scope, executionId: scope.executionId })
      : 1;
    const next = {
      ...current,
      status: "cancelled",
      updatedAt: now,
      terminalAt: now,
      reason: scope.reason,
    };
    if (scope.executionId)
      await this.executions.write({
        conversationId: scope.conversationId,
        agentId: scope.agentId,
        runId: scope.runId,
        executionId: scope.executionId,
        attempt,
        recoverability: "none",
        status: "cancelled",
        startedAt: String(current.createdAt ?? now),
        completedAt: now,
      });
    await this.events?.append({
      type: "run.cancelled",
      durability: "durable",
      conversationId: scope.conversationId,
      agentId: scope.agentId,
      runId: scope.runId,
      data: {
        ...this.commonData,
        conversationId: scope.conversationId,
        agentId: scope.agentId,
        runId: scope.runId,
        status: "cancelled",
        cancelledAt: now,
      },
    });
    await this.store.write(next);
    this.runLog(scope).info("run cancelled", { reason: scope.reason });
    return next;
  }

  async appendTranscriptEntry(
    scope: RunScope,
    entry: {
      entryId: string;
      index: number;
      role: "user" | "assistant" | "tool" | "system";
      content:
        | { text: string; truncated?: boolean; bytes?: number }
        | ArtifactRef;
      details?: unknown;
      turnId?: string;
      liveMessageId?: string;
      createdAt: string;
    },
  ): Promise<void> {
    await this.transcript.append(scope, entry);
    await this.events?.append({
      type: "run.transcript.appended",
      durability: "durable",
      conversationId: scope.conversationId,
      agentId: scope.agentId,
      runId: scope.runId,
      data: {
        ...this.commonData,
        conversationId: scope.conversationId,
        agentId: scope.agentId,
        runId: scope.runId,
        ...entry,
      },
    });
    const conversationEntry = toConversationEntry(scope, entry);
    if (conversationEntry) {
      await this.events?.append({
        type: "conversation.entry.appended",
        durability: "durable",
        conversationId: scope.conversationId,
        agentId: scope.agentId,
        runId: scope.runId,
        data: {
          conversationId: scope.conversationId,
          agentId: scope.agentId,
          runId: scope.runId,
          turnId: conversationEntry.turnId,
          liveMessageId: conversationEntry.liveMessageId,
          entry: conversationEntry,
        },
      });
    }
  }

  async start(
    input: Parameters<RunManager["createRun"]>[0],
  ): Promise<RunState> {
    return (await this.createRun(input)).run;
  }

  async read(scope: RunScope): Promise<RunState | undefined> {
    return this.store.read(scope);
  }

  async list(): Promise<RunState[]> {
    return this.store.list();
  }

  async createExecutionAttempt(
    scope: RunScope,
    reason: string,
  ): Promise<{ executionId: string; attempt: number }> {
    const existing = await this.executions.list(scope);
    const attempt =
      Math.max(0, ...existing.map((entry) => entry.attempt ?? 0)) + 1;
    const executionId = `exec_${Date.now()}_${attempt}`;
    await this.executions.write({
      ...scope,
      executionId,
      attempt,
      recoverability: "retryable",
      status: "starting",
      startedAt: new Date().toISOString(),
      terminalReason: reason,
    });
    return { executionId, attempt };
  }

  async writeCheckpoint(
    scope: RunScope,
    kind: RunCheckpointKind,
    input: {
      status: SandboxRunStatus;
      executionId?: string;
      toolCallId?: string;
      waitId?: string;
      resolutionId?: string;
      transcriptEntryId?: string;
      recoverable?: boolean;
      summary?: { text: string; truncated?: boolean; bytes?: number };
      data?: Record<string, unknown>;
      checkpointId?: string;
    },
  ) {
    const checkpointId =
      input.checkpointId ?? `${kind}_${Date.now()}_${++this.counter}`;
    const checkpoint = await this.checkpoints.write(scope, {
      checkpointId,
      kind,
      status: input.status,
      executionId: input.executionId,
      attempt: input.executionId
        ? await this.attemptFor({ ...scope, executionId: input.executionId })
        : undefined,
      toolCallId: input.toolCallId,
      waitId: input.waitId,
      resolutionId: input.resolutionId,
      transcriptEntryId: input.transcriptEntryId,
      recoverable: input.recoverable,
      summary: input.summary,
      data: input.data,
    });
    const current = await this.store.read(scope);
    if (current)
      await this.store.write({
        ...current,
        lastCheckpointId: checkpoint.checkpointId,
        updatedAt: new Date().toISOString(),
      });
    return checkpoint;
  }

  executionStore(): RunExecutionStore {
    return this.executions;
  }

  transcriptStore(): TranscriptStore {
    return this.transcript;
  }

  toolCallStore(): ToolCallStore {
    return this.tools;
  }

  checkpointStore(): RunCheckpointStore {
    return this.checkpoints;
  }

  private async attemptFor(
    scope: RunScope & { executionId: string },
  ): Promise<number> {
    const existing = await this.executions.read(scope);
    return existing?.attempt ?? 1;
  }

  private async require(scope: RunScope): Promise<RunState> {
    const current = await this.store.read(scope);
    if (!current) throw new Error(`Unknown run: ${scope.runId}`);
    return current;
  }
}

function toConversationEntry(
  scope: RunScope,
  entry: {
    entryId: string;
    role: "user" | "assistant" | "tool" | "system";
    content:
      | { text: string; truncated?: boolean; bytes?: number }
      | ArtifactRef;
    details?: unknown;
    turnId?: string;
    liveMessageId?: string;
    createdAt: string;
  },
): ConversationEntry | undefined {
  if (entry.role === "tool") return undefined;
  return {
    id: entry.entryId.startsWith("entry_")
      ? entry.entryId
      : `entry_${entry.entryId}`,
    conversationId: scope.conversationId,
    agentId: scope.agentId,
    runId: scope.runId,
    turnId: entry.turnId,
    liveMessageId: entry.liveMessageId,
    role: entry.role,
    kind: "message",
    text: transcriptText(entry.content),
    details: entry.details,
    createdAt: entry.createdAt,
  };
}

function transcriptText(
  content: { text: string; truncated?: boolean; bytes?: number } | ArtifactRef,
): string {
  if ("text" in content) return content.text;
  return `[artifact: ${content.path ?? content.contentId ?? content.url ?? "redacted"}]`;
}
