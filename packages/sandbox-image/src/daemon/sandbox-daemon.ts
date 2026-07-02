import type {
  ContextFileStatus,
  SandboxConfigV1,
  SandboxRunStatus,
  SkillStatus,
  StartupSetupStatus,
} from "@nervekit/shared";
import { RunManager } from "../agent/run-manager.js";
import { RunStateStore } from "../agent/run-state-store.js";
import type { ResolvedModelRuntime } from "../models/model-runtime.js";
import type { SandboxStateStores } from "../state/sandbox-state.js";
import { ApprovalWaiter } from "../tools/approval-waiter.js";
import { InputWaiter } from "../tools/input-waiter.js";
import { SandboxCommandRouter } from "./command-router.js";
import { DaemonStatusMachine } from "./daemon-status.js";
import { SandboxCommandError } from "./errors.js";
import { buildSandboxSnapshot } from "./snapshots.js";

export type SandboxDaemonRecoveredState = {
  setup?: { git?: StartupSetupStatus; github?: StartupSetupStatus };
  skills?: SkillStatus[];
  contextFiles?: ContextFileStatus[];
  modelRuntime?: ResolvedModelRuntime;
};

export class SandboxDaemon {
  readonly status = new DaemonStatusMachine();
  readonly router = new SandboxCommandRouter();
  readonly startedAt = new Date().toISOString();
  private readonly runs?: RunManager;
  private readonly inputWaiter?: InputWaiter;
  private readonly approvalWaiter?: ApprovalWaiter;
  constructor(
    private readonly config: SandboxConfigV1,
    private readonly configDigest: string,
    private readonly instanceId = `inst_${Date.now()}`,
    private readonly state?: SandboxStateStores,
    private readonly recovered: SandboxDaemonRecoveredState = {},
  ) {
    this.runs = state
      ? new RunManager(
          new RunStateStore(state.stateDir),
          state.stateDir,
          state.events,
        )
      : undefined;
    this.inputWaiter = state ? new InputWaiter(state.stateDir) : undefined;
    this.approvalWaiter = state
      ? new ApprovalWaiter(state.stateDir)
      : undefined;
    void this.inputWaiter?.load();
    void this.approvalWaiter?.load();
    this.registerBuiltins();
  }
  start(): void {
    this.status.transition("ready");
  }
  private registerBuiltins(): void {
    this.router.register("sandbox.status.get", async () => {
      const runs = (await this.runs?.list()) ?? [];
      const ack = await this.state?.events.ackState();
      const modelSummaries = this.modelSummaries();
      const waits = [
        ...(this.inputWaiter?.list() ?? []),
        ...(this.approvalWaiter?.list() ?? []),
      ];
      return {
        sandboxId: this.config.identity?.sandboxId,
        instanceId: this.instanceId,
        status: this.status.status,
        connected: true,
        stale: false,
        configDigest: this.configDigest,
        startedAt: this.startedAt,
        updatedAt: new Date().toISOString(),
        setup: this.recovered.setup,
        skills: this.recovered.skills,
        toolGroups: [],
        models: modelSummaries,
        cursors: ack,
        connectivity: { state: "connected", connectedAt: this.startedAt },
        conversations: summarizeConversations(runs),
        agents: summarizeAgents(runs, modelSummaries[0]),
        runs: summarizeRuns(runs, waits),
      };
    });
    this.router.register("sandbox.snapshot.get", async () =>
      buildSandboxSnapshot({
        config: this.config,
        configDigest: this.configDigest,
        instanceId: this.instanceId,
        status: this.status.status,
        connected: true,
        stale: false,
        updatedAt: new Date().toISOString(),
        connectivity: { state: "connected", connectedAt: this.startedAt },
        conversations: summarizeConversations((await this.runs?.list()) ?? []),
        agents: summarizeAgents(
          (await this.runs?.list()) ?? [],
          this.modelSummaries()[0],
        ),
        runs: summarizeRuns((await this.runs?.list()) ?? [], [
          ...(this.inputWaiter?.list() ?? []),
          ...(this.approvalWaiter?.list() ?? []),
        ]),
        toolGroups: [],
        setup: this.recovered.setup,
        models: this.modelSummaries(),
      }),
    );
    this.router.register("sandbox.run.start", async (params) => {
      const parsed = params as { prompt?: string; behavior?: string };
      const initialPrompt = this.config.agent.initialPrompt;
      if (!parsed.prompt && !initialPrompt)
        throw new SandboxCommandError(
          "VALIDATION_FAILED",
          "sandbox.run.start requires prompt or agent.initialPrompt",
        );
      if (this.recovered.modelRuntime?.degraded)
        throw new SandboxCommandError(
          "UNAVAILABLE",
          "No usable model provider is available for this sandbox",
        );
      const accepted = await this.acceptCommand("sandbox.run.start", params);
      const run = await this.runs?.start({
        ...(params as Record<string, unknown>),
        prompt: parsed.prompt ?? initialPrompt,
        commandId: accepted.commandId,
      });
      return {
        accepted: true,
        commandId: accepted.commandId,
        conversationId: run?.conversationId ?? "conv_unknown",
        agentId: run?.agentId ?? "agent_main",
        runId: run?.runId ?? `run_${Date.now()}`,
        status: run?.status ?? "queued",
      };
    });
    this.router.register("sandbox.run.continue", async (params) => ({
      accepted: true,
      commandId: await this.commandId("sandbox.run.continue", params),
      ...(params as object),
      status: "queued",
    }));
    this.router.register("sandbox.run.cancel", async (params) => {
      const input = params as {
        conversationId: string;
        agentId: string;
        runId: string;
        reason?: string;
      };
      const commandId = await this.commandId("sandbox.run.cancel", params);
      const run = await this.runs?.cancel(input);
      await this.inputWaiter?.cancelRun(input);
      await this.approvalWaiter?.cancelRun(input);
      return {
        accepted: true,
        commandId,
        ...input,
        status: run?.status ?? "cancelled",
        cancellationRequested: true,
      };
    });
    this.router.register("sandbox.input.submit", async (params) => {
      const input = params as {
        commandId?: string;
        conversationId?: string;
        agentId?: string;
        runId: string;
        requestId: string;
        text: string;
      };
      const accepted = await this.acceptCommand("sandbox.input.submit", params);
      try {
        await this.inputWaiter?.submit({
          ...input,
          commandId: accepted.commandId,
        });
      } catch (error) {
        throw mapWaitError(error, "UNKNOWN_INPUT_REQUEST");
      }
      return {
        accepted: true,
        commandId: accepted.commandId,
        ...input,
        status: "queued",
      };
    });
    this.router.register("sandbox.approval.resolve", async (params) => {
      const input = params as {
        commandId?: string;
        conversationId?: string;
        agentId?: string;
        runId: string;
        approvalId: string;
        decision: "grant" | "deny";
        note?: string;
        selectedScope?: "single_call" | "same_tool_same_args" | "run";
      };
      const accepted = await this.acceptCommand(
        "sandbox.approval.resolve",
        params,
      );
      try {
        await this.approvalWaiter?.resolve(
          input.approvalId,
          input.decision,
          input.note,
          { selectedScope: input.selectedScope, commandId: accepted.commandId },
        );
      } catch (error) {
        throw mapWaitError(error, "UNKNOWN_APPROVAL");
      }
      return {
        accepted: true,
        commandId: accepted.commandId,
        ...input,
        status: "queued",
      };
    });
  }

  private async commandId(method: string, params: unknown): Promise<string> {
    return (await this.acceptCommand(method, params)).commandId;
  }

  private modelSummaries(): Array<{
    provider: string;
    model?: string;
    active: boolean;
    status: "available" | "unavailable" | "degraded" | "skipped";
    limitations?: string[];
  }> {
    const runtime = this.recovered.modelRuntime;
    if (!runtime)
      return [
        {
          provider: this.config.agent.mainModel.provider,
          model: this.config.agent.mainModel.model,
          active: true,
          status: "available",
        },
      ];
    return runtime.models.map((model, index) => ({
      provider: model.provider,
      model: model.model,
      active: index === 0,
      status: runtime.degraded ? "degraded" : "available",
      limitations: model.limitations.length ? model.limitations : undefined,
    }));
  }

  private async acceptCommand(
    method: string,
    params: unknown,
  ): Promise<{ commandId: string }> {
    const commandId = (params as { commandId?: string }).commandId;
    const id = commandId ?? `cmd_${Date.now()}`;
    await this.state?.commands.accept({
      commandId: id,
      messageId: `msg_${Date.now()}`,
      method,
      params,
      conversationId: (params as { conversationId?: string }).conversationId,
      agentId: (params as { agentId?: string }).agentId,
      runId: (params as { runId?: string }).runId,
    });
    return { commandId: id };
  }
}

type RunLike = {
  conversationId: string;
  agentId: string;
  runId?: string;
  status?: string;
  updatedAt: string;
  createdAt?: string;
  terminalAt?: string;
  behavior?: unknown;
  prompt?: unknown;
  error?: unknown;
};

function summarizeConversations(runs: RunLike[]) {
  const summaries = new Map<
    string,
    {
      conversationId: string;
      agentIds: string[];
      updatedAt: string;
      activeRunIds: string[];
    }
  >();
  for (const run of runs) {
    const current = summaries.get(run.conversationId) ?? {
      conversationId: run.conversationId,
      agentIds: [],
      updatedAt: run.updatedAt,
      activeRunIds: [],
    };
    if (!current.agentIds.includes(run.agentId))
      current.agentIds.push(run.agentId);
    if (
      run.runId &&
      run.status &&
      !["completed", "failed", "cancelled"].includes(run.status)
    )
      current.activeRunIds.push(run.runId);
    if (run.updatedAt > current.updatedAt) current.updatedAt = run.updatedAt;
    summaries.set(run.conversationId, current);
  }
  return Array.from(summaries.values());
}

function summarizeAgents(runs: RunLike[], model?: unknown) {
  const agents = new Map<
    string,
    {
      conversationId: string;
      agentId: string;
      model?: unknown;
      updatedAt?: string;
    }
  >();
  for (const run of runs) {
    const key = `${run.conversationId}/${run.agentId}`;
    const current = agents.get(key) ?? {
      conversationId: run.conversationId,
      agentId: run.agentId,
      model,
      updatedAt: run.updatedAt,
    };
    if (!current.updatedAt || run.updatedAt > current.updatedAt)
      current.updatedAt = run.updatedAt;
    agents.set(key, current);
  }
  return Array.from(agents.values());
}

function summarizeRuns(runs: RunLike[], waits: unknown[] = []) {
  return runs.map((run) => ({
    conversationId: run.conversationId,
    agentId: run.agentId,
    runId: run.runId ?? "run_unknown",
    status: normalizeRunStatus(run.status),
    behavior:
      run.behavior === "follow_up" || run.behavior === "steer"
        ? run.behavior
        : "start",
    promptSummary:
      typeof run.prompt === "string" && run.prompt
        ? run.prompt.slice(0, 120)
        : undefined,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    terminalAt: run.terminalAt,
    error: isRedactedError(run.error) ? run.error : undefined,
    transcriptRefs: run.runId
      ? [`transcript://${run.conversationId}/${run.agentId}/${run.runId}`]
      : undefined,
    waits: run.runId ? summarizeWaitsForRun(waits, run.runId) : undefined,
    continueEligible:
      run.status === "waiting_for_input" ||
      run.status === "waiting_for_approval" ||
      run.status === "recoverable_failed",
  }));
}

function summarizeWaitsForRun(waits: unknown[], runId: string) {
  const summaries = waits
    .filter((wait) => (wait as { runId?: unknown }).runId === runId)
    .map((wait) => {
      const value = wait as Record<string, unknown>;
      if (typeof value.requestId === "string") {
        return {
          waitId: value.requestId,
          kind: "input" as const,
          status: normalizeWaitStatus(value.status),
          question: value.question,
          createdAt: String(value.createdAt ?? new Date().toISOString()),
          resolvedAt:
            typeof value.resolvedAt === "string" ? value.resolvedAt : undefined,
        };
      }
      return {
        waitId: String(value.approvalId ?? value.id ?? "approval_unknown"),
        kind: "approval" as const,
        status: normalizeWaitStatus(value.status),
        toolCallId:
          typeof value.toolCallId === "string" ? value.toolCallId : undefined,
        approvalScope:
          value.selectedScope === "single_call" ||
          value.selectedScope === "same_tool_same_args" ||
          value.selectedScope === "run"
            ? value.selectedScope
            : undefined,
        risks: Array.isArray(value.risk) ? (value.risk as string[]) : undefined,
        reason: typeof value.reason === "string" ? value.reason : undefined,
        createdAt: String(value.createdAt ?? new Date().toISOString()),
        resolvedAt:
          typeof value.resolvedAt === "string" ? value.resolvedAt : undefined,
      };
    });
  return summaries.length ? summaries : undefined;
}

function normalizeWaitStatus(status: unknown) {
  if (
    status === "waiting" ||
    status === "submitted" ||
    status === "granted" ||
    status === "denied" ||
    status === "cancelled" ||
    status === "expired"
  )
    return status;
  return "waiting" as const;
}

function normalizeRunStatus(status: string | undefined): SandboxRunStatus {
  if (
    status === "queued" ||
    status === "running" ||
    status === "waiting_for_input" ||
    status === "waiting_for_approval" ||
    status === "completed" ||
    status === "failed" ||
    status === "recoverable_failed" ||
    status === "cancelled"
  )
    return status;
  return "failed";
}

function mapWaitError(
  error: unknown,
  unknownCode: "UNKNOWN_INPUT_REQUEST" | "UNKNOWN_APPROVAL",
): SandboxCommandError {
  const message = error instanceof Error ? error.message : String(error);
  if (/Conflicting/.test(message))
    return new SandboxCommandError("IDEMPOTENCY_CONFLICT", message);
  if (/already resolved|already answered|already/i.test(message))
    return new SandboxCommandError("ALREADY_RESOLVED", message);
  if (/mismatch/.test(message))
    return new SandboxCommandError("VALIDATION_FAILED", message);
  return new SandboxCommandError(unknownCode, message);
}

function isRedactedError(
  value: unknown,
): value is { code: string; message: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { code?: unknown }).code === "string" &&
    typeof (value as { message?: unknown }).message === "string"
  );
}
