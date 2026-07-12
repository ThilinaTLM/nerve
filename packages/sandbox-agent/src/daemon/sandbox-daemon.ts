/* eslint-disable max-lines -- The daemon centralizes command registration and runtime wiring. */
import type { AgentMessage } from "@nervekit/host-runtime/harness";
import type {
  ContextFileStatus,
  PlanReviewRecord,
  SandboxConfigV1,
  SkillStatus,
  StartupSetupStatus,
  StructuredLogger,
} from "@nervekit/contracts";
import {
  createNoopLogger,
  parseInlineCommandPrompt,
  runStartParamsSchema,
  summarizeSandboxStartupEvents,
} from "@nervekit/contracts";
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
import { sandboxSha256Digest } from "../state/hash.js";
import type { SandboxStateStores } from "../state/sandbox-state.js";
import { ApprovalWaiter } from "../tools/approval-waiter.js";
import { InputWaiter } from "../tools/input-waiter.js";
import {
  PlanReviewWaiter,
  sandboxProjectId,
} from "../tools/plan-review-waiter.js";
import { SandboxTaskService } from "../tools/sandbox-task-service.js";

import { SandboxToolRuntime } from "../tools/tool-runtime.js";
import { mapRuntimeError, mapWaitError } from "./operation-errors.js";
import { SandboxOperationRouter } from "./operation-router.js";
import { buildConversationSnapshot } from "./conversation-snapshot.js";
import { DaemonStatusMachine } from "./daemon-status.js";
import { SandboxOperationError } from "./errors.js";
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
  readonly router = new SandboxOperationRouter();
  readonly startedAt = new Date().toISOString();
  private runs?: RunManager;
  private inputWaiter?: InputWaiter;
  private planReviewWaiter?: PlanReviewWaiter;
  private approvalWaiter?: ApprovalWaiter;
  private agentRuntime?: SandboxAgentRuntime;
  private taskService?: SandboxTaskService;
  private toolRuntime?: SandboxToolRuntime;
  private bridge?: HarnessEventBridge;
  private harnessFactory?: HarnessFactory;
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
    if (recovered.bootOnly !== true) {
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
    this.planReviewWaiter = new PlanReviewWaiter(
      state.stateDir,
      sandboxProjectId(this.identity.sandboxId),
    );
    this.approvalWaiter = new ApprovalWaiter(state.stateDir);
    const loadPromises: Array<Promise<unknown>> = [
      this.inputWaiter.load(),
      this.planReviewWaiter.load(),
      this.approvalWaiter.load(),
    ];
    this.agentConfigStore = new AgentConfigStore(state.stateDir);
    loadPromises.push(this.agentConfigStore.load());
    const taskConfig = this.config.tools?.groups?.taskManagement;
    this.taskService = new SandboxTaskService({
      stateDir: state.stateDir,
      workspaceDir: this.workspaceDir,
      events: state.events,
      maxTasks: taskConfig?.maxTasks,
      maxTaskRuntimeMs: taskConfig?.maxTaskRuntimeMs,
    });
    loadPromises.push(this.taskService.load());
    const eventCommonData = {
      instanceId: this.identity.instanceId,
      configDigest: this.configDigest,
      sandboxId: this.identity.sandboxId,
    };
    const readOnlyToolRuntime = new SandboxToolRuntime(this.config, {
      workspaceDir: this.workspaceDir,
      stateDir: state.stateDir,
      readOnly: true,
      secretResolver: recovered.secretResolver,
      toolCallStore: this.runs.toolCallStore(),
    });
    this.toolRuntime = new SandboxToolRuntime(this.config, {
      workspaceDir: this.workspaceDir,
      stateDir: state.stateDir,
      secretResolver: recovered.secretResolver,
      approvalWaiter: this.approvalWaiter,
      inputWaiter: this.inputWaiter,
      planReviewWaiter: this.planReviewWaiter,
      configStore: this.agentConfigStore,
      taskService: this.taskService,
      toolCallStore: this.runs.toolCallStore(),
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
    this.harnessFactory = factory;
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
        planReview: this.planReviewWaiter,
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
      planReviewWaiter: this.planReviewWaiter,
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
    registerSandboxGitHandlers(
      this.router,
      this.workspaceDir,
      this.state ? (event) => this.state!.events.append(event) : undefined,
    );
    registerSandboxTaskHandlers(
      this.router,
      () => this.taskService,
      this.workspaceDir,
    );
    this.router.register("sandbox.status.get", async () => {
      const runs = (await this.runs?.list()) ?? [];
      const ack = await this.state?.events.ackState();
      const modelSummaries = this.modelSummaries();
      const waits = [
        ...(this.inputWaiter?.list() ?? []),
        ...(this.planReviewWaiter?.list() ?? []),
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
            ...(this.planReviewWaiter?.list() ?? []),
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
    this.router.register("agent.configure", async (params) => {
      await this.requireReady();
      if (!this.agentConfigStore)
        throw new SandboxOperationError(
          "UNAVAILABLE",
          "Runtime configuration store is unavailable",
        );
      const parsed = params as {
        agentId: string;
        model?: { provider: string; modelId: string } | null;
        thinkingLevel?:
          | "off"
          | "minimal"
          | "low"
          | "medium"
          | "high"
          | "xhigh"
          | "max";
        mode?: "planning" | "coding";
        permissionLevel?: "read_only" | "supervised" | "autonomous";
        approvalPolicy?: { autoApproveReadOnly?: boolean };
      };
      const patch = {
        model: parsed.model
          ? {
              provider: parsed.model.provider,
              model: parsed.model.modelId,
              thinkingLevel: parsed.thinkingLevel,
            }
          : undefined,
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
      void overlay;
      return {
        accepted: true,
        agentId: parsed.agentId,
        effectiveAt: nextRunOnly ? "next_run" : "immediate",
      };
    });
    this.router.register("toolCall.get", async (params) => {
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
        throw new SandboxOperationError("UNKNOWN_RUN", "Tool call not found");
      return {
        toolCall,
        argsPreview: toolCall.displayArgs,
        resultPreview: toolResultPreview(toolCall.result),
        displayTitle: toolCall.toolName,
        displaySummary: toolCall.error?.message,
      };
    });
    this.router.register("run.start", async (params, context) => {
      await this.requireReady();
      const parsed = runStartParamsSchema.parse(params ?? {});
      const accepted = await this.acceptRequest(
        "run.start",
        params,
        context.idempotencyKey,
        context.requestId,
      );
      const prompt = parsed.text;
      if (!prompt)
        throw new SandboxOperationError(
          "VALIDATION_FAILED",
          "run.start requires text",
        );
      const inlineCommand = parseInlineCommandPrompt(prompt);
      if (!inlineCommand && this.recovered.modelRuntime?.degraded)
        throw new SandboxOperationError(
          "UNAVAILABLE",
          "No usable model provider is available for this sandbox",
        );
      if (inlineCommand && !this.agentRuntime)
        throw new SandboxOperationError(
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
              requestId: accepted.requestId,
            })
          : await (this.agentRuntime
              ? this.agentRuntime.startRun({
                  ...(params as Record<string, unknown>),
                  prompt,
                  requestId: accepted.requestId,
                })
              : this.runs?.start({
                  ...(params as Record<string, unknown>),
                  prompt,
                  requestId: accepted.requestId,
                }));
      } catch (error) {
        const mapped = mapRuntimeError(error);
        throw mapped;
      }
      const result = {
        accepted: true,
        conversationId: run?.conversationId ?? "conv_unknown",
        agentId: run?.agentId ?? "agent_main",
        runId: run?.runId ?? `run_${Date.now()}`,
        status: run?.status ?? "queued",
      };
      return result;
    });
    this.router.register("run.followUp", (params, context) =>
      this.router.dispatch("run.start", params, context),
    );
    this.router.register("run.steer", async (params) => {
      await this.requireReady();
      const input = params as {
        conversationId?: string;
        agentId: string;
        runId?: string;
        text: string;
      };
      if (!input.conversationId || !input.runId)
        throw new SandboxOperationError(
          "VALIDATION_FAILED",
          "run.steer requires conversationId and runId",
        );
      await this.agentRuntime?.steerRun(
        {
          conversationId: input.conversationId,
          agentId: input.agentId,
          runId: input.runId,
        },
        input.text,
      );
      const result = { accepted: true, ...input, status: "running" as const };
      return result;
    });
    this.router.register("run.continue", async (params) => {
      await this.requireReady();
      try {
        await this.agentRuntime?.continueRun(
          params as { conversationId: string; agentId: string; runId: string },
        );
      } catch (error) {
        const mapped = mapRuntimeError(error);
        throw mapped;
      }
      const result = {
        accepted: true,
        ...(params as object),
        status: "queued",
      };
      return result;
    });
    this.router.register("run.cancel", async (params) => {
      await this.requireReady();
      const input = params as {
        conversationId: string;
        agentId: string;
        runId: string;
        reason?: string;
      };
      let run: RunState | undefined;
      try {
        run = this.agentRuntime
          ? await this.agentRuntime.cancelRun(input)
          : await this.runs?.cancel(input);
        await this.inputWaiter?.cancelRun(input);
        await this.planReviewWaiter?.cancelRun(input);
        await this.approvalWaiter?.cancelRun(input);
      } catch (error) {
        const mapped = mapRuntimeError(error);
        throw mapped;
      }
      const result = {
        accepted: true,
        ...input,
        status: run?.status ?? "cancelled",
        cancellationRequested: true,
      };
      return result;
    });
    this.router.register("userQuestion.answer", async (params, context) => {
      await this.requireReady();
      const input = params as { questionId: string; answer: string };
      const accepted = await this.acceptRequest(
        "userQuestion.answer",
        params,
        context.idempotencyKey,
        context.requestId,
      );
      try {
        const wait = this.inputWaiter?.get(input.questionId);
        if (!wait)
          throw new Error(`Unknown input request: ${input.questionId}`);
        if (wait.status === "submitted" && wait.response?.text !== input.answer)
          throw new Error(`Conflicting input submission: ${input.questionId}`);
        const scope = {
          conversationId: wait.conversationId,
          agentId: wait.agentId,
          runId: wait.runId,
        };
        const entryId = toolResultEntryId(scope.runId, input.questionId);
        const toolResult = {
          question: wait.question.text,
          context: wait.context,
          recommendation: wait.recommendation,
          response: input.answer,
        };
        const message: AgentMessage = {
          role: "toolResult",
          toolCallId: input.questionId,
          toolName: "ask_user",
          content: [{ type: "text", text: input.answer.slice(0, 16_000) }],
          details: toolResult,
          isError: false,
          timestamp: Date.now(),
        };
        await this.harnessFactory?.appendConversationMessage(
          scope.conversationId,
          scope.agentId,
          entryId,
          message,
        );
        const checkpoint = await this.runs?.writeCheckpoint(
          scope,
          "input_resolution",
          {
            status: "waiting_for_input",
            waitId: input.questionId,
            resolutionId: accepted.requestId,
            transcriptEntryId: entryId,
            summary: { text: "user input submitted" },
          },
        );
        await this.inputWaiter?.submit({
          ...scope,
          requestId: input.questionId,
          text: input.answer,
          resolutionRequestId: accepted.requestId,
          toolResultEntryId: entryId,
          checkpointId: checkpoint?.checkpointId,
        });
        await this.bridge?.completeSuspendedTool(
          scope,
          input.questionId,
          "ask_user",
          toolResult,
        );
        const run = await this.runs?.read(scope);
        if (run?.status === "waiting_for_input")
          await this.agentRuntime?.continueRun({
            ...scope,
            reason: "input_submitted",
          });
      } catch (error) {
        if (error instanceof SandboxOperationError) throw error;
        const mapped = mapWaitError(error, "UNKNOWN_INPUT_REQUEST");
        throw mapped;
      }
      const result = {
        accepted: true,
        interactionId: input.questionId,
        status: "answered" as const,
      };
      return result;
    });
    this.router.register("planReview.accept", async (params, context) => {
      await this.requireReady();
      const input = params as {
        conversationId?: string;
        agentId?: string;
        runId?: string;
        reviewId: string;
        decision?: "accept" | "request_changes" | "discard";
        feedback?: string;
        implementationModel?: { provider: string; modelId: string };
        implementationThinkingLevel?:
          | "off"
          | "minimal"
          | "low"
          | "medium"
          | "high"
          | "xhigh"
          | "max";
      };
      const decision =
        context.requestedMethod === "planReview.requestChanges"
          ? "request_changes"
          : context.requestedMethod === "planReview.discard"
            ? "discard"
            : "accept";
      const accepted = await this.acceptRequest(
        context.requestedMethod ?? "planReview.accept",
        params,
        context.idempotencyKey,
        context.requestId,
      );
      try {
        const pending = this.planReviewWaiter?.get(input.reviewId);
        if (!pending) throw new Error(`Unknown plan review: ${input.reviewId}`);
        const scope = {
          conversationId: input.conversationId ?? pending.conversationId,
          agentId: input.agentId ?? pending.agentId,
          runId: input.runId ?? pending.runId,
        };
        if (decision === "accept") {
          await this.agentConfigStore?.update({
            mode: "coding",
            model: input.implementationModel
              ? {
                  provider: input.implementationModel.provider,
                  model: input.implementationModel.modelId,
                  thinkingLevel: input.implementationThinkingLevel,
                }
              : input.implementationThinkingLevel
                ? { thinkingLevel: input.implementationThinkingLevel }
                : undefined,
          });
        } else if (decision === "request_changes") {
          await this.agentConfigStore?.update({ mode: "planning" });
        } else {
          await this.agentConfigStore?.update({ mode: "coding" });
        }
        const entryId = toolResultEntryId(
          scope.runId,
          pending.providerToolCallId,
        );
        const resolved = await this.planReviewWaiter?.resolve({
          ...input,
          ...scope,
          decision,
          resolutionRequestId: accepted.requestId,
          toolResultEntryId: entryId,
        });
        if (!resolved)
          throw new Error(`Unknown plan review: ${input.reviewId}`);
        const result = planReviewToolResult(resolved.review);
        const message: AgentMessage = {
          role: "toolResult",
          toolCallId: resolved.providerToolCallId,
          toolName: "plan_mode_present",
          content: [{ type: "text", text: String(result.content) }],
          details: result,
          isError: false,
          timestamp: Date.now(),
        };
        await this.harnessFactory?.appendConversationMessage(
          scope.conversationId,
          scope.agentId,
          entryId,
          message,
        );
        await this.bridge?.completeSuspendedTool(
          scope,
          resolved.providerToolCallId,
          "plan_mode_present",
          result,
        );
        await this.state?.events.append({
          type: "planReview.updated",
          durability: "durable",
          conversationId: scope.conversationId,
          agentId: scope.agentId,
          runId: scope.runId,
          data: {
            sandboxId: this.identity.sandboxId,
            instanceId: this.identity.instanceId,
            configDigest: this.configDigest,
            ...scope,
            reviewId: resolved.review.id,
            decision,
            planReview: resolved.review,
            resolvedAt: resolved.resolvedAt,
          },
        });
        const run = await this.runs?.read(scope);
        if (decision === "discard") {
          if (run?.status === "waiting_for_input") {
            await this.runs?.markCompleted(scope);
            await this.bridge?.completeRun(scope);
          }
        } else if (run?.status === "waiting_for_input") {
          await this.agentRuntime?.continueRun({
            ...scope,
            reason: "plan_review_resolved",
          });
        }
        const resultEnvelope = {
          accepted: true,
          ...scope,
          reviewId: input.reviewId,
          interactionId: input.reviewId,
          status:
            decision === "accept"
              ? "accepted"
              : decision === "request_changes"
                ? "changes_requested"
                : "discarded",
        };
        return resultEnvelope;
      } catch (error) {
        const mapped = mapWaitError(error, "UNKNOWN_PLAN_REVIEW");
        throw mapped;
      }
    });
    this.router.register("planReview.requestChanges", (params, context) =>
      this.router.dispatch("planReview.accept", params, context),
    );
    this.router.register("planReview.discard", (params, context) =>
      this.router.dispatch("planReview.accept", params, context),
    );
    this.router.register("approval.grant", async (params, context) => {
      await this.requireReady();
      const input = params as {
        conversationId?: string;
        agentId?: string;
        runId?: string;
        approvalId: string;
        decision?: "grant" | "deny";
        note?: string;
        selectedScope?: "single_call" | "same_tool_same_args" | "run";
      };
      const decision =
        context.requestedMethod === "approval.deny" ? "deny" : "grant";
      const accepted = await this.acceptRequest(
        context.requestedMethod ?? "approval.grant",
        params,
        context.idempotencyKey,
        context.requestId,
      );
      try {
        const pending = this.approvalWaiter
          ?.list()
          .find((approval) => approval.id === input.approvalId);
        const scope = pending
          ? {
              conversationId: pending.conversationId,
              agentId: pending.agentId,
              runId: pending.runId,
            }
          : undefined;
        const checkpoint = scope
          ? await this.runs?.writeCheckpoint(scope, "approval_resolution", {
              status: "waiting_for_approval",
              waitId: input.approvalId,
              resolutionId: accepted.requestId,
              summary: { text: `approval ${decision}` },
            })
          : undefined;
        await this.approvalWaiter?.resolve(
          input.approvalId,
          decision,
          input.note,
          {
            selectedScope: input.selectedScope,
            resolutionRequestId: accepted.requestId,
            checkpointId: checkpoint?.checkpointId,
          },
        );
        if (scope)
          await this.agentRuntime?.continueRun({
            ...scope,
            reason: "approval_resolved",
          });
      } catch (error) {
        if (error instanceof SandboxOperationError) throw error;
        const mapped = mapWaitError(error, "UNKNOWN_APPROVAL");
        throw mapped;
      }
      const result = {
        accepted: true,
        interactionId: input.approvalId,
        status: decision === "grant" ? "granted" : "denied",
      };
      return result;
    });
    this.router.register("approval.deny", (params, context) =>
      this.router.dispatch("approval.grant", params, context),
    );
  }

  private async requireReady(): Promise<void> {
    if (!this.runtimeReady || this.status.status === "booting") {
      throw new SandboxOperationError(
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

  private async acceptRequest(
    _method: string,
    _params: unknown,
    idempotencyKey?: string,
    requestId?: string,
  ): Promise<{ requestId: string }> {
    return { requestId: requestId ?? idempotencyKey ?? `req_${Date.now()}` };
  }
}

function planReviewToolResult(
  review: PlanReviewRecord,
): Record<string, unknown> {
  const content =
    review.status === "accepted"
      ? "Plan accepted. Implement the accepted plan now."
      : review.status === "changes_requested"
        ? "Plan changes requested. Revise the plan using the feedback and present it again."
        : "Plan discarded.";
  return {
    review,
    outcome: review.status,
    feedback: review.feedback,
    mode: review.status === "accepted" ? "coding" : "planning",
    content,
    contentBlocks: [{ type: "text", text: content }],
  };
}

function toolResultEntryId(runId: string, toolCallId: string): string {
  return `msg_tool_result_${sandboxSha256Digest(`${runId}:${toolCallId}`).slice(7, 23)}`;
}
