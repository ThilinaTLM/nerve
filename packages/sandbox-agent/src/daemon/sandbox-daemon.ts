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
  sandboxAgentConfigureParamsSchema,
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
import { ArtifactStore } from "../state/artifacts.js";
import type { SandboxStateStores } from "../state/sandbox-state.js";
import { ApprovalWaiter } from "../tools/approval-waiter.js";
import { InputWaiter } from "../tools/input-waiter.js";
import { TaskSupervisor } from "../tools/task-supervisor.js";

import { SandboxToolRuntime } from "../tools/tool-runtime.js";
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
};

export class SandboxDaemon {
  readonly status = new DaemonStatusMachine();
  readonly router = new SandboxCommandRouter();
  readonly startedAt = new Date().toISOString();
  private readonly runs?: RunManager;
  private readonly inputWaiter?: InputWaiter;
  private readonly approvalWaiter?: ApprovalWaiter;
  private readonly agentRuntime?: SandboxAgentRuntime;
  private readonly taskSupervisor?: TaskSupervisor;
  private readonly toolRuntime?: SandboxToolRuntime;
  private readonly bridge?: HarnessEventBridge;
  private readonly exploreRuntime?: ExploreRuntime;
  private readonly agentConfigStore?: AgentConfigStore;
  private readonly workspaceDir: string;
  private readonly ready: Promise<void>;
  constructor(
    private readonly config: SandboxConfigV1,
    private readonly configDigest: string,
    private readonly instanceId = `inst_${Date.now()}`,
    private readonly state?: SandboxStateStores,
    private readonly recovered: SandboxDaemonRecoveredState = {},
  ) {
    // Production always injects a logger from the entrypoint; the NOOP fallback
    // keeps daemons constructed without one (e.g. tests) silent.
    const logger = recovered.logger ?? createNoopLogger();
    this.workspaceDir =
      recovered.workspaceDir ?? config.agent.workspaceRoot ?? process.cwd();
    this.runs = state
      ? new RunManager(
          new RunStateStore(state.stateDir),
          state.stateDir,
          state.events,
          undefined,
          {
            instanceId,
            configDigest,
            sandboxId: config.identity?.sandboxId,
          },
          logger.child({ component: "run-manager" }),
        )
      : undefined;
    this.inputWaiter = state ? new InputWaiter(state.stateDir) : undefined;
    this.approvalWaiter = state
      ? new ApprovalWaiter(state.stateDir)
      : undefined;
    const loadPromises: Array<Promise<unknown>> = [];
    if (this.inputWaiter) loadPromises.push(this.inputWaiter.load());
    if (this.approvalWaiter) loadPromises.push(this.approvalWaiter.load());
    if (state) {
      this.agentConfigStore = new AgentConfigStore(state.stateDir);
      loadPromises.push(this.agentConfigStore.load());
      const taskConfig = config.tools?.groups?.taskManagement;
      this.taskSupervisor = new TaskSupervisor({
        stateDir: state.stateDir,
        maxTasks: taskConfig?.maxTasks,
        maxTaskRuntimeMs: taskConfig?.maxTaskRuntimeMs,
      });
      loadPromises.push(this.taskSupervisor.load());
    }
    if (state && this.runs) {
      const workspaceDir = this.workspaceDir;
      const eventCommonData = {
        instanceId,
        configDigest,
        sandboxId: config.identity?.sandboxId,
      };
      const readOnlyToolRuntime = new SandboxToolRuntime(config, {
        workspaceDir,
        stateDir: state.stateDir,
        readOnly: true,
        toolCallStore: this.runs.toolCallStore(),
        events: state.events,
        eventCommonData,
      });
      this.toolRuntime = new SandboxToolRuntime(config, {
        workspaceDir,
        stateDir: state.stateDir,
        approvalWaiter: this.approvalWaiter,
        inputWaiter: this.inputWaiter,
        taskSupervisor: this.taskSupervisor,
        toolCallStore: this.runs.toolCallStore(),
        events: state.events,
        eventCommonData,
      });
      const factory = new HarnessFactory(config, {
        workspaceDir,
        stateDir: state.stateDir,
        toolRuntime: this.toolRuntime,
        secretResolver: recovered.secretResolver,
        skills: recovered.skills,
        contextFiles: recovered.contextFiles,
        configStore: this.agentConfigStore,
      });
      this.exploreRuntime = new ExploreRuntime({
        config,
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
        {
          instanceId,
          configDigest,
          sandboxId: config.identity?.sandboxId,
        },
        new ArtifactStore(state.stateDir),
        logger.child({ component: "harness-bridge" }),
      );
      this.agentRuntime = new SandboxAgentRuntime(config, {
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
    }
    this.ready = Promise.all(loadPromises).then(() => {
      const effective = this.agentConfigStore?.effective(this.config);
      if (effective) {
        this.toolRuntime?.updatePolicy({
          permissionLevel: effective.permissionLevel,
          approvalPolicy: effective.approvalPolicy,
        });
      }
    });
    this.registerBuiltins();
  }
  start(): void {
    this.status.transition("ready");
  }
  private registerBuiltins(): void {
    registerSandboxGitHandlers(this.router, this.workspaceDir);
    registerSandboxTaskHandlers(
      this.router,
      this.taskSupervisor,
      this.workspaceDir,
    );
    this.router.register("sandbox.status.get", async () => {
      await this.ready;
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
      await this.ready;
      return buildSandboxSnapshot({
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
        setup: this.recovered.setup,
        models: this.modelSummaries(),
      });
    });
    this.router.register(
      "sandbox.conversation.snapshot.get",
      async (params) => {
        await this.ready;
        const input = params as {
          conversationId?: string;
          agentId?: string;
          runId?: string;
        };
        const snapshot = await buildConversationSnapshot({
          config: this.config,
          instanceId: this.instanceId,
          runs: this.runs,
          bridge: this.bridge,
          cursorSeq: this.state?.events.all().at(-1)?.seq ?? 0,
          ...input,
        });
        return {
          sandboxId: this.config.identity?.sandboxId,
          instanceId: this.instanceId,
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
      await this.ready;
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
      await this.ready;
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
      await this.ready;
      const parsed = params as {
        prompt?: string;
        behavior?: "start" | "follow_up" | "steer";
        conversationId?: string;
        agentId?: string;
        runId?: string;
      };
      const accepted = await this.acceptCommand("sandbox.run.start", params);
      if (accepted.result) return accepted.result.result;
      const initialPrompt = this.config.agent.initialPrompt;
      const prompt = parsed.prompt ?? initialPrompt;
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
          "sandbox.run.start requires prompt or agent.initialPrompt",
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
      await this.ready;
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
      await this.ready;
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
      await this.ready;
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
      await this.ready;
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

function mapRuntimeError(error: unknown): SandboxCommandError {
  if (error instanceof SandboxCommandError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("UNAVAILABLE"))
    return new SandboxCommandError("UNAVAILABLE", message);
  if (message.startsWith("INVALID_RUN_STATE"))
    return new SandboxCommandError("INVALID_RUN_STATE", message);
  if (message.startsWith("VALIDATION_FAILED"))
    return new SandboxCommandError("VALIDATION_FAILED", message);
  return new SandboxCommandError("INTERNAL_ERROR", message.slice(0, 500));
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
