import { Redactor } from "../security/redaction.js";
import type { EventOutbox } from "../state/event-outbox.js";
import { RunExecutionStore } from "./run-execution-store.js";
import type { RunState, RunStateStore } from "./run-state-store.js";
import { TranscriptStore } from "./transcript-store.js";

export class RunManager {
  private counter = 0;
  private readonly transcript: TranscriptStore;
  private readonly executions: RunExecutionStore;
  private readonly redactor: Redactor;
  constructor(
    private readonly store: RunStateStore,
    stateDir: string,
    private readonly events?: EventOutbox,
    redactor = new Redactor({ secrets: [] }),
  ) {
    this.transcript = new TranscriptStore(stateDir);
    this.executions = new RunExecutionStore(stateDir);
    this.redactor = redactor;
  }
  async start(input: {
    commandId?: string;
    conversationId?: string;
    agentId?: string;
    prompt?: string;
    behavior?: "start" | "follow_up" | "steer";
  }): Promise<RunState> {
    const now = new Date().toISOString();
    const conversationId = input.conversationId ?? `conv_${Date.now()}`;
    const agentId = input.agentId ?? "agent_main";
    const runId = `run_${Date.now()}_${++this.counter}`;
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
    };
    await this.store.write(state);
    await this.executions.write({
      conversationId,
      agentId,
      runId,
      executionId: `exec_${Date.now()}_${this.counter}`,
      attempt: 1,
      recoverability: "retryable",
      status: "starting",
      startedAt: now,
    });
    if (input.prompt) {
      await this.transcript.append(state, {
        entryId: `entry_${Date.now()}_0`,
        index: 0,
        role: "user",
        content: { text: this.redactor.redactText(input.prompt) },
        createdAt: now,
      });
    }
    await this.events?.append({
      type: "run.started",
      durability: "durable",
      conversationId,
      agentId,
      runId,
      data: {
        commandId: input.commandId ?? "cmd_unknown",
        status: "queued",
        promptSummary: input.prompt
          ? this.redactor.redactText(input.prompt).slice(0, 120)
          : undefined,
        model: { provider: "configured", model: "configured" },
        startedAt: now,
      },
    });
    return state;
  }
  async cancel(scope: {
    conversationId: string;
    agentId: string;
    runId: string;
    reason?: string;
  }): Promise<RunState> {
    const current = await this.store.read(scope);
    if (!current) throw new Error(`Unknown run: ${scope.runId}`);
    const now = new Date().toISOString();
    const next = {
      ...current,
      status: "cancelled",
      updatedAt: now,
      terminalAt: now,
      reason: scope.reason,
    };
    await this.store.write(next);
    await this.events?.append({
      type: "run.cancelled",
      durability: "durable",
      conversationId: scope.conversationId,
      agentId: scope.agentId,
      runId: scope.runId,
      data: { status: "cancelled", cancelledAt: now },
    });
    return next;
  }
  async list(): Promise<RunState[]> {
    return this.store.list();
  }
}
