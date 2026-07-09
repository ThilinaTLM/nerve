import type {
  ContextFileStatus,
  SandboxConfigV1,
  SkillStatus,
  StartupSetupStatus,
  StructuredLogger,
} from "@nervekit/shared";
import {
  createNoopLogger,
  parseInlineCommandPrompt,
  summarizeSandboxStartupEvents,
  sandboxAgentConfigureParamsSchema,
  sandboxRunStartParamsSchema,
} from "@nervekit/shared";
import {
  AgentConfigStore,
  sanitizeEffectiveAgentConfig,
} from "../agent/agent-config-store.js";
import { SandboxAgentRuntime } from "../agent/agent-runtime.js";
import { ExploreRuntime } from "../agent/explore-runtime.js";

import { HarnessEventBridge } from "../agent/harness-event-bridge.js";
import { HarnessFactory } from "../agent/harness-factory.js";
import { RunManager } from "../agent/run-manager.js";
import type { RunState } from "../agent/run-state-store.js";
import { RunStateStore } from "../agent/run-state-store.js";
import { toolResultPreview } from "../agent/tool-result-preview.js";
import type { SecretResolver } from "../credentials/secret-resolver.js";
import type { ResolvedModelRuntime } from "../models/model-runtime.js";
import type { SandboxRuntimeIdentity } from "../runtime/identity.js";
import { ArtifactStore } from "../state/artifacts.js";
import type { SandboxStateStores } from "../state/sandbox-state.js";
import { ApprovalWaiter } from "../tools/approval-waiter.js";
import { InputWaiter } from "../tools/input-waiter.js";
import { TaskSupervisor } from "../tools/task-supervisor.js";

import { SandboxToolRuntime } from "../tools/tool-runtime.js";
import { mapRuntimeError, mapWaitError } from "./command-errors.js";
import { SandboxCommandRouter } from "./command-router.js";
import { buildConversationSnapshot } from "./conversation-snapshot.js";
import { DaemonStatusMachine } from "./daemon-status.js";
import { SandboxCommandError } from "./errors.js";
import {
  summarizeAgents,
  summarizeConversations,
  summarizeRuns,
} from "./run-summaries.js";
import { registerSandboxGitHandlers } from "./sandbox-git-handlers.js";
import { registerSandboxTaskHandlers } from "./sandbox-task-handlers.js";
import { buildSandboxSnapshot } from "./snapshots.js";

export type SandboxDaemonRecoveredState = {
  setup?: { git?: StartupSetupStatus; github?: StartupSetupStatus };
  skills?: SkillStatus[];
  contextFiles?: ContextFileStatus[];
  modelRuntime?: ResolvedModelRuntime;
  workspaceDir?: string;
  secretResolver?: SecretResolver;
  logger?: StructuredLogger;
  bootOnly?: boolean;
};

export class SandboxDaemon {
  readonly status = new DaemonStatusMachine();
  readonly router = new SandboxCommandRouter();
  readonly startedAt = new Date().toISOString();
  private runs?: RunManager;
  private inputWaiter?: InputWaiter;
  private approvalWaiter?: ApprovalWaiter;
  private agentRuntime?: SandboxAgentRuntime;
  private taskSupervisor?: TaskSupervisor;
  private toolRuntime?: SandboxToolRuntime;
  private bridge?: HarnessEventBridge;
  private exploreRuntime?: ExploreRuntime;
  private agentConfigStore?: AgentConfigStore;
  private workspaceDir: string;
  private ready: Promise<void> = Promise.resolve();
  private runtimeReady = false;
  private initializingRuntime?: Promise<void>;
  private recovered: SandboxDaemonRecoveredState = {};
  private readonly identity: SandboxRuntimeIdentity;
  private readonly logger: StructuredLogger;
  constructor(
    private readonly config: SandboxConfigV1,
    private readonly configDigest: string,
    identity: SandboxRuntimeIdentity | string = {
      sandboxId: "unknown",
      instanceId: `inst_${Date.now()}`,
    },
    private readonly state?: SandboxStateStores,
    recovered: SandboxDaemonRecoveredState = {},
  ) {
    this.identity =
      typeof identity === "string"
        ? { sandboxId: "unknown", instanceId: identity }
        : identity;
    // Production always injects a logger from the entrypoint; the NOOP fallback
    // keeps daemons constructed without one (e.g. tests) silent.
    this.logger = recovered.logger ?? createNoopLogger();
    this.recovered = recovered;
    this.workspaceDir =
      recovered.workspaceDir ?? config.agent.workspaceRoot ?? process.cwd();
    this.registerBuiltins();
    if (shouldInitializeRuntime(recovered)) {
      this.ready = this.initializeRuntime(recovered);
    }
  }

  async initializeRuntime(
    recovered: SandboxDaemonRecoveredState,
  ): Promise<void> {
    if (this.runtimeReady) return;
    if (this.initializingRuntime) return this.initializingRuntime;
    this.initializingRuntime = this.initializeRuntimeInner(recovered);
    this.ready = this.initializingRuntime;
    await this.initializingRuntime;
  }

  markReady(status: "ready" | "degraded" = "ready"): void {
    this.runtimeReady = true;
    this.status.transition(status);
  }

  start(): void {
    this.markReady("ready");
  }

  private async initializeRuntimeInner(
    recovered: SandboxDaemonRecoveredState,
  ): Promise<void> {
    if (!this.state) {
      this.runtimeReady = true;
      return;
    }
    this.recovered = { ...this.recovered, ...recovered };
    this.workspaceDir =
      recovered.workspaceDir ??
      this.config.agent.workspaceRoot ??
      process.cwd();
    const state = this.state;
    const logger = recovered.logger ?? this.logger;
    this.runs = new RunManager(
      new RunStateStore(state.stateDir),
      state.stateDir,
      state.events,
      undefined,
      {
        instanceId: this.identity.instanceId,
        configDigest: this.configDigest,
        sandboxId: this.identity.sandboxId,
      },
      logger.child({ component: "run-manager" }),
    );
    this.inputWaiter = new InputWaiter(state.stateDir);
    this.approvalWaiter = new ApprovalWaiter(state.stateDir);
    const loadPromises: Array<Promise<unknown>> = [
      this.inputWaiter.load(),
      this.approvalWaiter.load(),
    ];
    this.agentConfigStore = new AgentConfigStore(state.stateDir);
    loadPromises.push(this.agentConfigStore.load());
    const taskConfig = this.config.tools?.groups?.taskManagement;
    this.taskSupervisor = new TaskSupervisor({
      stateDir: state.stateDir,
      maxTasks: taskConfig?.maxTasks,
      maxTaskRuntimeMs: taskConfig?.maxTaskRuntimeMs,
    });
    loadPromises.push(this.taskSupervisor.load());
    const eventCommonData = {
      instanceId: this.identity.instanceId,
      configDigest: this.configDigest,
      sandboxId: this.identity.sandboxId,
    };
    const readOnlyToolRuntime = new SandboxToolRuntime(this.config, {
      workspaceDir: this.workspaceDir,
      stateDir: state.stateDir,
      readOnly: true,
      toolCallStore: this.runs.toolCallStore(),
      events: state.events,
      eventCommonData,
    });
    this.toolRuntime = new SandboxToolRuntime(this.config, {
      workspaceDir: this.workspaceDir,
      stateDir: state.stateDir,
      approvalWaiter: this.approvalWaiter,
      inputWaiter: this.inputWaiter,
      taskSupervisor: this.taskSupervisor,
      toolCallStore: this.runs.toolCallStore(),
      events: state.events,
      eventCommonData,
    });
    const factory = new HarnessFactory(this.config, {
      workspaceDir: this.workspaceDir,
      stateDir: state.stateDir,
      toolRuntime: this.toolRuntime,
      secretResolver: recovered.secretResolver,
      skills: recovered.skills,
      contextFiles: recovered.contextFiles,
      configStore: this.agentConfigStore,
    });
    this.exploreRuntime = new ExploreRuntime({
      config: this.config,
      stateDir: state.stateDir,
      readOnlyToolRuntime,
      createChildHarness: (scope, options) => factory.create(scope, options),
    });
    readOnlyToolRuntime.setExploreRuntime(this.exploreRuntime);
    this.toolRuntime.setExploreRuntime(this.exploreRuntime);
    this.bridge = new HarnessEventBridge(
      state.events,
      this.runs,
      {
        input: this.inputWaiter,
        approval: this.approvalWaiter,
      },
      eventCommonData,
      new ArtifactStore(state.stateDir),
      logger.child({ component: "harness-bridge" }),
    );
    this.agentRuntime = new SandboxAgentRuntime(this.config, {
      runs: this.runs,
      harnessFactory: factory,
      bridge: this.bridge,
      inputWaiter: this.inputWaiter,
      approvalWaiter: this.approvalWaiter,
      toolRuntime: this.toolRuntime,
      exploreRuntime: this.exploreRuntime,
      configStore: this.agentConfigStore,
      logger: logger.child({ component: "agent-runtime" }),
    });
    loadPromises.push(this.agentRuntime.recoverActiveRuns());
    await Promise.all(loadPromises);
    const effective = this.agentConfigStore.effective(this.config);
    this.toolRuntime.updatePolicy({
      permissionLevel: effective.permissionLevel,
      approvalPolicy: effective.approvalPolicy,
    });
    this.runtimeReady = true;
  }

  private registerBuiltins(): void {
    registerSandboxGitHandlers(this.router, this.workspaceDir);
    registerSandboxTaskHandlers(
      this.router,
      () => this.taskSupervisor,
      this.workspaceDir,
    );
    this.router.register("sandbox.status.get", async () => {
      const runs = (await this.runs?.list()) ?? [];
      const ack = await this.state?.events.ackState();
      const modelSummaries = this.modelSummaries();
      const waits = [
        ...(this.inputWaiter?.list() ?? []),
        ...(this.approvalWaiter?.list() ?? []),
      ];
      const startup = summarizeSandboxStartupEvents(
        this.state?.events.all() ?? [],
      );
      return {
        sandboxId: this.identity.sandboxId,
        instanceId: this.identity.instanceId,
        status: this.status.status,
        connected: true,
        stale: false,
        configDigest: this.configDigest,
        startedAt: this.startedAt,
        updatedAt: new Date().toISOString(),
        setup: startup.setup ?? this.recovered.setup,
        setupTimeline: startup.timeline,
        skills: this.recovered.skills,
        toolGroups: this.toolRuntime?.groups() ?? [],
        models: modelSummaries,
        cursors: ack,
        connectivity: { state: "connected", connectedAt: this.startedAt },
        conversations: summarizeConversations(runs),
        agents: summarizeAgents(runs, modelSummaries[0]),
        runs: await summarizeRuns(runs, waits, this.runs, this.state?.stateDir),
        agentConfig: sanitizeEffectiveAgentConfig(
          this.config,
          this.agentConfigStore,
        ),
      };
    });
    this.router.register("sandbox.snapshot.get", async () => {
      const startup = summarizeSandboxStartupEvents(
        this.state?.events.all() ?? [],
      );
      return buildSandboxSnapshot({
        config: this.config,
        configDigest: this.configDigest,
        sandboxId: this.identity.sandboxId,
        instanceId: this.identity.instanceId,
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
        runs: await summarizeRuns(
          (await this.runs?.list()) ?? [],
          [
            ...(this.inputWaiter?.list() ?? []),
            ...(this.approvalWaiter?.list() ?? []),
          ],
          this.runs,
          this.state?.stateDir,
        ),
        toolGroups: this.toolRuntime?.groups() ?? [],
        setup: startup.setup ?? this.recovered.setup,
        setupTimeline: startup.timeline,
        models: this.modelSummaries(),
      });
    });
    this.router.register(
      "sandbox.conversation.snapshot.get",
      async (params) => {
        const input = params as {
          conversationId?: string;
          agentId?: string;
          runId?: string;
        };
        const snapshot = await buildConversationSnapshot({
          config: this.config,
          sandboxId: this.identity.sandboxId,
          instanceId: this.identity.instanceId,
          runs: this.runs,
          bridge: this.bridge,
          cursorSeq: this.state?.events.all().at(-1)?.seq ?? 0,
          ...input,
        });
        return {
          sandboxId: this.identity.sandboxId,
          instanceId: this.identity.instanceId,
          status: this.status.status,
          connected: true,
          stale: false,
          lastEventSeq: this.state?.events.all().at(-1)?.seq,
          lastEventAt: this.state?.events.all().at(-1)?.ts,
          conversationId: input.conversationId ?? snapshot?.conversation.id,
          agentId: input.agentId ?? snapshot?.conversation.activeAgentId,
          runId: input.runId ?? snapshot?.activeRun?.runId,
          snapshot,
          fallback: snapshot
            ? undefined
            : {
                conversations: summarizeConversations(
                  (await this.runs?.list()) ?? [],
                ),
                agents: summarizeAgents(
                  (await this.runs?.list()) ?? [],
                  this.modelSummaries()[0],
                ),
                runs: [],
                readOnly: true,
                reason: "no sandbox conversation transcript is available",
              },
          generatedAt: new Date().toISOString(),
        };
      },
    );
    this.router.register("sandbox.agent.configure", async (params) => {
      await this.requireReady();
      if (!this.agentConfigStore)
        throw new SandboxCommandError(
          "UNAVAILABLE",
          "Runtime configuration store is unavailable",
        );
      const parsed = sandboxAgentConfigureParamsSchema.parse(params ?? {});
      const patch = {
        model: parsed.model,
        mode: parsed.mode,
        permissionLevel: parsed.permissionLevel,
        approvalPolicy: parsed.approvalPolicy,
      };
      const overlay = await this.agentConfigStore.update(patch);
      if (parsed.permissionLevel || parsed.approvalPolicy) {
        this.toolRuntime?.updatePolicy({
          permissionLevel: parsed.permissionLevel,
          approvalPolicy: parsed.approvalPolicy,
        });
      }
      const nextRunOnly = Boolean(parsed.model || parsed.mode);
      return {
        applied: {
          conversationId: parsed.conversationId,
          agentId: parsed.agentId,
          model: overlay.model,
          mode: overlay.mode,
          permissionLevel: overlay.permissionLevel,
          approvalPolicy: overlay.approvalPolicy,
        },
        effective: this.agentConfigStore.effective(this.config),
        warnings: parsed.modelProfileId
          ? [
              "modelProfileId was accepted as a manager-side credential reference; sandbox runtime applied only resolved model fields",
            ]
          : [],
        effectiveAt: nextRunOnly ? "next_run" : "immediate",
      };
    });
    this.router.register("sandbox.toolCall.get", async (params) => {
      await this.requireReady();
      const input = params as {
        conversationId: string;
        agentId: string;
        runId: string;
        toolCallId: string;
      };
      const records = await this.runs
        ?.toolCallStore()
        .latestByToolCallId(input);
      const toolCall = records?.get(input.toolCallId);
      if (!toolCall)
        throw new SandboxCommandError("UNKNOWN_RUN", "Tool call not found");
      return {
        toolCall,
        argsPreview: toolCall.displayArgs,
        resultPreview: toolResultPreview(toolCall.result),
        displayTitle: toolCall.toolName,
        displaySummary: toolCall.error?.message,
      };
    });
    this.router.register("sandbox.run.start", async (params) => {
      await this.requireReady();
      const parsed = sandboxRunStartParamsSchema.parse(params ?? {});
      const accepted = await this.acceptCommand("sandbox.run.start", params);
      if (accepted.result) return accepted.result.result;
      const prompt = parsed.prompt;
      if (parsed.behavior === "steer") {
        if (
          !parsed.conversationId ||
          !parsed.agentId ||
          !parsed.runId ||
          !prompt
        )
          throw new SandboxCommandError(
            "VALIDATION_FAILED",
            "steer requires conversationId, agentId, runId, and prompt",
          );
        try {
          await this.agentRuntime?.steerRun(
            {
              conversationId: parsed.conversationId,
              agentId: parsed.agentId,
              runId: parsed.runId,
            },
            prompt,
          );
        } catch (error) {
          const mapped = mapRuntimeError(error);
          await this.state?.commands
            .fail(accepted.commandId, mapped)
            .catch(() => undefined);
          throw mapped;
        }
        const result = {
          accepted: true,
          commandId: accepted.commandId,
          conversationId: parsed.conversationId,
          agentId: parsed.agentId,
          runId: parsed.runId,
          status: "running",
        };
        await this.state?.commands
          .complete(accepted.commandId, result)
          .catch(() => undefined);
        return result;
      }
      if (!prompt)
        throw new SandboxCommandError(
          "VALIDATION_FAILED",
          "sandbox.run.start requires prompt",
        );
      const inlineCommand = parseInlineCommandPrompt(prompt);
      if (!inlineCommand && this.recovered.modelRuntime?.degraded)
        throw new SandboxCommandError(
          "UNAVAILABLE",
          "No usable model provider is available for this sandbox",
        );
      if (inlineCommand && !this.agentRuntime)
        throw new SandboxCommandError(
          "UNAVAILABLE",
          "Inline command execution is unavailable in this sandbox",
        );
      let run: RunState | undefined;
      try {
        run = inlineCommand
          ? await this.agentRuntime?.runInlineCommandPrompt({
              ...(params as Record<string, unknown>),
              prompt,
              command: inlineCommand.command,
              commandId: accepted.commandId,
            })
          : await (this.agentRuntime
              ? this.agentRuntime.startRun({
                  ...(params as Record<string, unknown>),
                  prompt,
                  commandId: accepted.commandId,
                })
              : this.runs?.start({
                  ...(params as Record<string, unknown>),
                  prompt,
                  commandId: accepted.commandId,
                }));
      } catch (error) {
        const mapped = mapRuntimeError(error);
        await this.state?.commands
          .fail(accepted.commandId, mapped)
          .catch(() => undefined);
        throw mapped;
      }
      const result = {
        accepted: true,
        commandId: accepted.commandId,
        conversationId: run?.conversationId ?? "conv_unknown",
        agentId: run?.agentId ?? "agent_main",
        runId: run?.runId ?? `run_${Date.now()}`,
        status: run?.status ?? "queued",
      };
      await this.state?.commands
        .complete(accepted.commandId, result)
        .catch(() => undefined);
      return result;
    });
    this.router.register("sandbox.run.continue", async (params) => {
      await this.requireReady();
      const accepted = await this.acceptCommand("sandbox.run.continue", params);
      if (accepted.result) return accepted.result.result;
      try {
        await this.agentRuntime?.continueRun(
          params as { conversationId: string; agentId: string; runId: string },
        );
      } catch (error) {
        const mapped = mapRuntimeError(error);
        await this.state?.commands
          .fail(accepted.commandId, mapped)
          .catch(() => undefined);
        throw mapped;
      }
      const result = {
        accepted: true,
        commandId: accepted.commandId,
        ...(params as object),
        status: "queued",
      };
      await this.state?.commands
        .complete(accepted.commandId, result)
        .catch(() => undefined);
      return result;
    });
    this.router.register("sandbox.run.cancel", async (params) => {
      await this.requireReady();
      const input = params as {
        conversationId: string;
        agentId: string;
        runId: string;
        reason?: string;
      };
      const accepted = await this.acceptCommand("sandbox.run.cancel", params);
      if (accepted.result) return accepted.result.result;
      let run: RunState | undefined;
      try {
        run = this.agentRuntime
          ? await this.agentRuntime.cancelRun(input)
          : await this.runs?.cancel(input);
        await this.inputWaiter?.cancelRun(input);
        await this.approvalWaiter?.cancelRun(input);
      } catch (error) {
        const mapped = mapRuntimeError(error);
        await this.state?.commands
          .fail(accepted.commandId, mapped)
          .catch(() => undefined);
        throw mapped;
      }
      const result = {
        accepted: true,
        commandId: accepted.commandId,
        ...input,
        status: run?.status ?? "cancelled",
        cancellationRequested: true,
      };
      await this.state?.commands
        .complete(accepted.commandId, result)
        .catch(() => undefined);
      return result;
    });
    this.router.register("sandbox.input.submit", async (params) => {
      await this.requireReady();
      const input = params as {
        commandId?: string;
        conversationId?: string;
        agentId?: string;
        runId: string;
        requestId: string;
        text: string;
      };
      const accepted = await this.acceptCommand("sandbox.input.submit", params);
      if (accepted.result) return accepted.result.result;
      try {
        const entryId = `entry_${Date.now()}_input`;
        const scope =
          input.conversationId && input.agentId
            ? {
                conversationId: input.conversationId,
                agentId: input.agentId,
                runId: input.runId,
              }
            : undefined;
        const checkpoint = scope
          ? await this.runs?.writeCheckpoint(scope, "input_resolution", {
              status: "waiting_for_input",
              waitId: input.requestId,
              resolutionId: accepted.commandId,
              transcriptEntryId: entryId,
              summary: { text: "user input submitted" },
            })
          : undefined;
        if (scope)
          await this.runs?.appendTranscriptEntry(scope, {
            entryId,
            index: Date.now(),
            role: "user",
            content: { text: input.text.slice(0, 16_000) },
            createdAt: new Date().toISOString(),
          });
        await this.inputWaiter?.submit({
          ...input,
          commandId: accepted.commandId,
          answerTranscriptEntryId: entryId,
          checkpointId: checkpoint?.checkpointId,
        });
        if (scope)
          await this.agentRuntime?.continueRun({
            ...scope,
            reason: "input_submitted",
          });
      } catch (error) {
        if (error instanceof SandboxCommandError) throw error;
        const mapped = mapWaitError(error, "UNKNOWN_INPUT_REQUEST");
        await this.state?.commands
          .fail(accepted.commandId, mapped)
          .catch(() => undefined);
        throw mapped;
      }
      const result = {
        accepted: true,
        commandId: accepted.commandId,
        ...input,
        status: "queued",
      };
      await this.state?.commands
        .complete(accepted.commandId, result)
        .catch(() => undefined);
      return result;
    });
    this.router.register("sandbox.approval.resolve", async (params) => {
      await this.requireReady();
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
      if (accepted.result) return accepted.result.result;
      try {
        const scope =
          input.conversationId && input.agentId
            ? {
                conversationId: input.conversationId,
                agentId: input.agentId,
                runId: input.runId,
              }
            : undefined;
        const checkpoint = scope
          ? await this.runs?.writeCheckpoint(scope, "approval_resolution", {
              status: "waiting_for_approval",
              waitId: input.approvalId,
              resolutionId: accepted.commandId,
              summary: { text: `approval ${input.decision}` },
            })
          : undefined;
        await this.approvalWaiter?.resolve(
          input.approvalId,
          input.decision,
          input.note,
          {
            selectedScope: input.selectedScope,
            commandId: accepted.commandId,
            checkpointId: checkpoint?.checkpointId,
          },
        );
        if (scope)
          await this.agentRuntime?.continueRun({
            ...scope,
            reason: "approval_resolved",
          });
      } catch (error) {
        if (error instanceof SandboxCommandError) throw error;
        const mapped = mapWaitError(error, "UNKNOWN_APPROVAL");
        await this.state?.commands
          .fail(accepted.commandId, mapped)
          .catch(() => undefined);
        throw mapped;
      }
      const result = {
        accepted: true,
        commandId: accepted.commandId,
        ...input,
        status: "queued",
      };
      await this.state?.commands
        .complete(accepted.commandId, result)
        .catch(() => undefined);
      return result;
    });
  }

  private async requireReady(): Promise<void> {
    if (!this.runtimeReady || this.status.status === "booting") {
      throw new SandboxCommandError(
        "BOOTING",
        "Sandbox daemon is still booting; try again after it is ready",
      );
    }
    await this.ready;
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
          provider: this.config.agent.defaultModel.provider,
          model: this.config.agent.defaultModel.model,
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
  ): Promise<{
    commandId: string;
    duplicate: boolean;
    result?: { result?: unknown };
  }> {
    const commandId = (params as { commandId?: string }).commandId;
    const id = commandId ?? `cmd_${Date.now()}`;
    try {
      const accepted = await this.state?.commands.accept({
        commandId: id,
        messageId: `msg_${Date.now()}`,
        method,
        params,
        conversationId: (params as { conversationId?: string }).conversationId,
        agentId: (params as { agentId?: string }).agentId,
        runId: (params as { runId?: string }).runId,
      });
      return {
        commandId: id,
        duplicate: Boolean(accepted?.duplicate),
        result: accepted?.result,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("IDEMPOTENCY_CONFLICT"))
        throw new SandboxCommandError("IDEMPOTENCY_CONFLICT", message);
      throw error;
    }
  }
}

function shouldInitializeRuntime(
  recovered: SandboxDaemonRecoveredState,
): boolean {
  return recovered.bootOnly !== true;
}
