import type {
  ContextFileStatus,
  SandboxConfigV1,
  SkillStatus,
  StartupSetupStatus,
} from "@nervekit/shared";
import { RunManager } from "../agent/run-manager.js";
import { RunStateStore } from "../agent/run-state-store.js";
import type { ResolvedModelRuntime } from "../models/model-runtime.js";
import type { SandboxStateStores } from "../state/sandbox-state.js";
import { SandboxCommandRouter } from "./command-router.js";
import { DaemonStatusMachine } from "./daemon-status.js";
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
    this.registerBuiltins();
  }
  start(): void {
    this.status.transition("ready");
  }
  private registerBuiltins(): void {
    this.router.register("sandbox.status.get", async () => ({
      sandboxId: this.config.identity?.sandboxId,
      instanceId: this.instanceId,
      status: this.status.status,
      configDigest: this.configDigest,
      startedAt: this.startedAt,
      updatedAt: new Date().toISOString(),
      setup: this.recovered.setup,
      skills: this.recovered.skills,
      toolGroups: [],
      cursors: await this.state?.events.ackState(),
      connectivity: { state: "connected", connectedAt: this.startedAt },
      conversations: summarizeConversations((await this.runs?.list()) ?? []),
      runs: (await this.runs?.list()) ?? [],
    }));
    this.router.register("sandbox.snapshot.get", async () =>
      buildSandboxSnapshot({
        config: this.config,
        configDigest: this.configDigest,
        status: this.status.status,
        connectivity: { state: "connected", connectedAt: this.startedAt },
        conversations: summarizeConversations((await this.runs?.list()) ?? []),
        runs: (await this.runs?.list()) ?? [],
        toolGroups: [],
        setup: this.recovered.setup,
      }),
    );
    this.router.register("sandbox.run.start", async (params) => {
      const accepted = await this.acceptCommand("sandbox.run.start", params);
      const run = await this.runs?.start({
        ...(params as Record<string, unknown>),
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
      return {
        accepted: true,
        commandId,
        ...input,
        status: run?.status ?? "cancelled",
        cancellationRequested: true,
      };
    });
    this.router.register("sandbox.input.submit", async (params) => ({
      accepted: true,
      commandId: await this.commandId("sandbox.input.submit", params),
      ...(params as object),
      status: "queued",
    }));
    this.router.register("sandbox.approval.resolve", async (params) => ({
      accepted: true,
      commandId: await this.commandId("sandbox.approval.resolve", params),
      ...(params as object),
      status: "queued",
    }));
  }

  private async commandId(method: string, params: unknown): Promise<string> {
    return (await this.acceptCommand(method, params)).commandId;
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

function summarizeConversations(
  runs: Array<{ conversationId: string; agentId: string; updatedAt: string }>,
) {
  const summaries = new Map<
    string,
    { conversationId: string; agentIds: string[]; updatedAt: string }
  >();
  for (const run of runs) {
    const current = summaries.get(run.conversationId) ?? {
      conversationId: run.conversationId,
      agentIds: [],
      updatedAt: run.updatedAt,
    };
    if (!current.agentIds.includes(run.agentId))
      current.agentIds.push(run.agentId);
    if (run.updatedAt > current.updatedAt) current.updatedAt = run.updatedAt;
    summaries.set(run.conversationId, current);
  }
  return Array.from(summaries.values());
}
