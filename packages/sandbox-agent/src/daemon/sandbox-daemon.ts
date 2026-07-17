/* eslint-disable max-lines -- The daemon centralizes command registration and runtime wiring. */
import type {
  ContextFileStatus,
  SandboxConfigV1,
  SkillStatus,
  StartupSetupStatus,
  StructuredLogger,
} from "@nervekit/contracts";
import {
  createNoopLogger,
  parseInlineCommandPrompt,
  runFollowUpParamsSchema,
  runStartParamsSchema,
  runSteerParamsSchema,
  summarizeSandboxStartupEvents,
  toPlanReviewPreview,
} from "@nervekit/contracts";
import {
  AgentConfigStore,
  sanitizeEffectiveAgentConfig,
} from "../agent/agent-config-store.js";
import { ExploreRuntime } from "../agent/explore-runtime.js";

import { HarnessFactory } from "../agent/harness-factory.js";
import type { SecretResolver } from "../credentials/secret-resolver.js";
import type { ResolvedModelRuntime } from "../models/model-runtime.js";
import type { SandboxRuntimeIdentity } from "../runtime/identity.js";
import type { SandboxStateStores } from "../state/sandbox-state.js";
import {
  SandboxPlanReviewStore,
  sandboxProjectId,
} from "../tools/plan-review-store.js";
import { SandboxTaskService } from "../tools/sandbox-task-service.js";

import { SandboxToolRuntime } from "../tools/tool-runtime.js";
import { mapRuntimeError, mapWaitError } from "./operation-errors.js";
import { SandboxOperationRouter } from "./operation-router.js";
import {
  createSandboxRunRuntime,
  mapRunStatusToSandbox,
  type SandboxRunRuntime,
} from "../run/index.js";
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
  private planReviewStore?: SandboxPlanReviewStore;
  private runRuntime?: SandboxRunRuntime;
  private taskService?: SandboxTaskService;
  private toolRuntime?: SandboxToolRuntime;
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
    // Retained narrowly as a plan-file validator/record builder until the plan
    // storage adapter is separated; it no longer owns run wait lifecycle.
    this.planReviewStore = new SandboxPlanReviewStore(
      state.stateDir,
      sandboxProjectId(this.identity.sandboxId),
    );
    const loadPromises: Array<Promise<unknown>> = [this.planReviewStore.load()];
    this.agentConfigStore = new AgentConfigStore(state.stateDir);
    loadPromises.push(this.agentConfigStore.load());
    const taskConfig = this.config.tools?.groups?.taskManagement;
    this.taskService = new SandboxTaskService({
      stateDir: state.stateDir,
      workspaceDir: this.workspaceDir,
      events: state.events,
      maxTasks: taskConfig?.maxTasks,
      maxTaskRuntimeMs: taskConfig?.maxTaskRuntimeMs,
      diagnostics: logger.child({ component: "task-service" }),
    });
    loadPromises.push(this.taskService.load());
    const readOnlyToolRuntime = new SandboxToolRuntime(this.config, {
      workspaceDir: this.workspaceDir,
      stateDir: state.stateDir,
      readOnly: true,
      secretResolver: recovered.secretResolver,
    });
    this.toolRuntime = new SandboxToolRuntime(this.config, {
      workspaceDir: this.workspaceDir,
      stateDir: state.stateDir,
      secretResolver: recovered.secretResolver,
      planReviewStore: this.planReviewStore,
      configStore: this.agentConfigStore,
      taskService: this.taskService,
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
    // Shared RunCoordinator is the sole authority for run lifecycle.
    this.runRuntime = createSandboxRunRuntime({
      config: this.config,
      stateDir: state.stateDir,
      outbox: state.events,
      harnessFactory: factory,
      toolRuntime: this.toolRuntime,
      taskService: this.taskService,
      exploreRuntime: this.exploreRuntime,
      logger: logger.child({ component: "run-coordinator" }),
    });
    this.toolRuntime.setInteractions(this.runRuntime.interactions);
    await Promise.all(loadPromises);
    // Recover runs through the coordinator: flush any pending event intents,
    // reconcile interrupted/waiting runs from checkpoints, then materialize.
    if (this.runRuntime) {
      await this.runRuntime.delivery.flush();
      await this.runRuntime.coordinator.recover();
      await this.runRuntime.delivery.flush();
    }
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
      const runs = (await this.runRuntime?.query.runLikes()) ?? [];
      const ack = await this.state?.events.ackState();
      const modelSummaries = this.modelSummaries();
      const waits = (await this.runRuntime?.query.waits()) ?? [];
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
        runs: await summarizeRuns(runs, waits, this.state?.stateDir),
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
      const snapshotRuns = (await this.runRuntime?.query.runLikes()) ?? [];
      const snapshotWaits = (await this.runRuntime?.query.waits()) ?? [];
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
        conversations: summarizeConversations(snapshotRuns),
        agents: summarizeAgents(snapshotRuns, this.modelSummaries()[0]),
        runs: await summarizeRuns(
          snapshotRuns,
          snapshotWaits,
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
        const states = (await this.runRuntime?.query.states()) ?? [];
        const snapshot = await buildConversationSnapshot({
          config: this.config,
          instanceId: this.identity.instanceId,
          states,
          cursorSeq: this.state?.events.all().at(-1)?.seq ?? 0,
          ...input,
        });
        const runLikes = (await this.runRuntime?.query.runLikes()) ?? [];
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
                conversations: summarizeConversations(runLikes),
                agents: summarizeAgents(runLikes, this.modelSummaries()[0]),
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
    this.router.register("agent.promptQueue.cancel", async (params) => {
      await this.requireReady();
      const input = params as { agentId: string; queuedPromptId: string };
      const state = await this.runRuntime?.unitOfWork.findByPromptId(
        input.queuedPromptId,
      );
      if (!state || state.run.agentId !== input.agentId)
        throw new SandboxOperationError(
          "INVALID_RUN_STATE",
          "Queued prompt was not found",
        );
      const queuedPrompt = await this.requireCoordinator().cancelPrompt(
        state.run.runId,
        input.queuedPromptId,
      );
      return { queuedPrompt };
    });
    this.router.register("toolCall.get", async (params) => {
      await this.requireReady();
      const input = params as {
        conversationId: string;
        agentId: string;
        runId: string;
        toolCallId: string;
      };
      const details = await this.runRuntime?.query.toolCall(
        input.toolCallId,
        input.runId,
      );
      if (!details)
        throw new SandboxOperationError("UNKNOWN_RUN", "Tool call not found");
      return details;
    });
    this.router.register("run.start", async (params, context) => {
      await this.requireReady();
      const parsed = runStartParamsSchema.parse(params ?? {});
      await this.acceptRequest(
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
      const p = (params as Record<string, unknown>) ?? {};
      const behavior = p.behavior === "follow_up" ? "follow-up" : undefined;
      let run;
      try {
        const coordinator = this.requireCoordinator();
        const scope = this.runScope(p);
        if (behavior === "follow-up") {
          const active = await this.runRuntime!.unitOfWork.findActive(
            scope.scopeId,
          );
          if (!active)
            throw new SandboxOperationError(
              "INVALID_RUN_STATE",
              "no active run for follow-up",
            );
          const queued = await coordinator.followUp(
            active.run.runId,
            prompt,
            parsed.images,
          );
          run = { ...active.run };
          return {
            accepted: true,
            conversationId: run.conversationId,
            agentId: run.agentId,
            runId: run.runId,
            status: mapRunStatusToSandbox(run.status),
            queuedPromptId: queued.id,
          };
        }
        run = await coordinator.start({
          conversationId: scope.conversationId,
          agentId: scope.agentId,
          projectId: scope.projectId,
          scopeId: scope.scopeId,
          prompt,
          images: parsed.images,
        });
        if (run.status === "failed" && run.failure) {
          throw new SandboxOperationError(
            run.failure.code === "RUN_CONSTRUCTION_FAILED"
              ? "UNAVAILABLE"
              : "INTERNAL",
            run.failure.message,
          );
        }
      } catch (error) {
        throw mapRuntimeError(error);
      }
      return {
        accepted: true,
        conversationId: run.conversationId,
        agentId: run.agentId,
        runId: run.runId,
        status: mapRunStatusToSandbox(run.status),
      };
    });
    this.router.register("run.followUp", async (params) => {
      await this.requireReady();
      const input = runFollowUpParamsSchema.parse(params ?? {});
      if (!input.conversationId || !input.runId) {
        throw new SandboxOperationError(
          "VALIDATION_FAILED",
          "run.followUp requires conversationId and runId",
        );
      }
      await this.requireCoordinator().followUp(
        input.runId,
        input.text,
        input.images,
      );
      return { accepted: true, ...input, status: "running" as const };
    });
    this.router.register("run.steer", async (params) => {
      await this.requireReady();
      const input = runSteerParamsSchema.parse(params ?? {});
      if (!input.conversationId || !input.runId)
        throw new SandboxOperationError(
          "VALIDATION_FAILED",
          "run.steer requires conversationId and runId",
        );
      await this.requireCoordinator().steer(
        input.runId,
        input.text,
        input.images,
      );
      const result = { accepted: true, ...input, status: "running" as const };
      return result;
    });
    this.router.register("run.continue", async (params) => {
      await this.requireReady();
      const input = params as { runId: string };
      try {
        await this.requireCoordinator().continue(input.runId);
      } catch (error) {
        throw mapRuntimeError(error);
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
      let run;
      try {
        run = await this.requireCoordinator().cancel(input.runId, input.reason);
      } catch (error) {
        throw mapRuntimeError(error);
      }
      const result = {
        accepted: true,
        ...input,
        status: mapRunStatusToSandbox(run.status),
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
        const coordinator = this.requireCoordinator();
        const interaction = await this.runRuntime!.references.interaction(
          input.questionId,
        );
        if (!interaction)
          throw new Error(`Unknown input request: ${input.questionId}`);
        // Resolve the durable interaction, then resume from its checkpoint. The
        // harness re-runs ask_user, whose resolve callback reads this durable
        // resolution and returns the answer without a manual transcript write.
        await coordinator.resolveInteraction(interaction.runId, {
          interactionId: input.questionId,
          resolutionRequestId: accepted.requestId,
          resolution: { text: input.answer },
        });
        await coordinator.continue(interaction.runId);
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
    this.router.register("userQuestion.dismiss", async (params, context) => {
      await this.requireReady();
      const input = params as { questionId: string; reason?: string };
      const accepted = await this.acceptRequest(
        "userQuestion.dismiss",
        params,
        context.idempotencyKey,
        context.requestId,
      );
      try {
        const coordinator = this.requireCoordinator();
        const interaction = await this.runRuntime!.references.interaction(
          input.questionId,
        );
        if (!interaction || interaction.kind !== "question")
          throw new Error(`Unknown input request: ${input.questionId}`);
        await coordinator.resolveInteraction(interaction.runId, {
          interactionId: input.questionId,
          resolutionRequestId: accepted.requestId,
          resolution: {
            dismissed: true,
            dismissedReason: input.reason ?? "Dismissed by user.",
          },
        });
        await coordinator.continue(interaction.runId);
      } catch (error) {
        if (error instanceof SandboxOperationError) throw error;
        throw mapWaitError(error, "UNKNOWN_INPUT_REQUEST");
      }
      return {
        accepted: true,
        interactionId: input.questionId,
        status: "dismissed" as const,
      };
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
        const coordinator = this.requireCoordinator();
        const interaction = await this.runRuntime!.references.interaction(
          input.reviewId,
        );
        if (!interaction || interaction.kind !== "plan_review")
          throw new Error(`Unknown plan review: ${input.reviewId}`);
        const scope = {
          conversationId: interaction.conversationId,
          agentId: interaction.agentId,
          runId: interaction.runId,
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
        const resolvedAt = new Date().toISOString();
        const reviewStatus =
          decision === "accept"
            ? "accepted"
            : decision === "request_changes"
              ? "changes_requested"
              : "discarded";
        const planRecord = await this.planReviewStore?.recordResolution({
          reviewId: input.reviewId,
          ...scope,
          decision,
          feedback: input.feedback,
          implementationModel: input.implementationModel,
          implementationThinkingLevel: input.implementationThinkingLevel,
          resolutionRequestId: accepted.requestId,
        });
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
            reviewId: interaction.planReview.id,
            decision,
            planReview: toPlanReviewPreview(
              planRecord?.review ?? {
                ...interaction.planReview,
                status: reviewStatus,
                updatedAt: resolvedAt,
              },
            ),
            resolvedAt,
          },
        });
        // Resolve the durable interaction and resume from its checkpoint; the
        // harness re-runs plan_mode_present, which returns the review result.
        await coordinator.resolveInteraction(interaction.runId, {
          interactionId: input.reviewId,
          resolutionRequestId: accepted.requestId,
          resolution: {
            decision,
            feedback: input.feedback,
            planReview: planRecord?.review,
          },
        });
        await coordinator.continue(interaction.runId);
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
        const coordinator = this.requireCoordinator();
        const interaction = await this.runRuntime!.references.interaction(
          input.approvalId,
        );
        if (!interaction)
          throw new Error(`Unknown approval request: ${input.approvalId}`);
        await coordinator.resolveInteraction(interaction.runId, {
          interactionId: input.approvalId,
          resolutionRequestId: accepted.requestId,
          resolution: {
            decision: decision === "grant" ? "allow" : "deny",
            selectedScope: input.selectedScope,
          },
        });
        await coordinator.continue(interaction.runId);
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

  private requireCoordinator() {
    if (!this.runRuntime)
      throw new SandboxOperationError(
        "UNAVAILABLE",
        "run coordinator is not configured",
      );
    return this.runRuntime.coordinator;
  }

  private runScope(p: Record<string, unknown>) {
    const conversationId =
      typeof p.conversationId === "string" &&
      p.conversationId.startsWith("conv_")
        ? p.conversationId
        : `conv_${Date.now()}`;
    const agentId =
      typeof p.agentId === "string" && p.agentId.startsWith("agent_")
        ? p.agentId
        : "agent_main";
    return {
      conversationId,
      agentId,
      projectId: sandboxProjectId(this.identity.sandboxId),
      scopeId: `${conversationId}:${agentId}`,
    };
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
