import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  AgentHarness,
  AgentToolSuspension,
  buildConversationContext,
  Conversation,
  calculateContextTokens,
  computeContextUsage,
  convertToLlm,
  deriveAutoCompactionPolicy,
  getModelContextWindow,
  isAgentToolSuspension,
  isContextOverflowAssistantMessage,
  NodeExecutionEnv,
  resolveAgentModel,
  shouldAutoCompact,
} from "@nerve/agent";
import {
  type AgentRecord,
  type ContextUsage,
  type ConversationEntry,
  type ConversationRecord,
  type ConversationRunRetryExhaustedData,
  type ConversationRunStatusDetails,
  type CreateAgentRequest,
  createId,
  type PromptRequest,
  type ToolName,
  toolNameSchema,
} from "@nerve/shared";
import type { AuthManager } from "../../../auth.js";
import { HttpError } from "../../../http/errors.js";
import type { EventBus } from "../../../infrastructure/events/index.js";
import type { InitializedStorage } from "../../../infrastructure/storage/index.js";
import type { ApplicationLogger } from "../../../logging.js";
import { loadHarnessResources } from "../../../resource-loader.js";
import type { RuntimeState } from "../../../runtime/runtime-state.js";
import type { ConversationService } from "../../conversations/conversation-service.js";
import type { HarnessManager } from "../../conversations/harness-manager.js";
import type { CompactionService } from "../../conversations/operations/index.js";
import { planDirForStorageHome } from "../../plans/plan-paths.js";
import type { PythonRuntimeService } from "../../runtime/python-runtime-service.js";
import {
  activeToolNamesForAgent,
  createAgentToolsForAgent,
  toolPromptMetadata,
} from "../../tools/agent-tool-adapter.js";
import type {
  ExploreProgressUpdate,
  ToolService,
} from "../../tools/tool-service.js";
import type { SubscriptionUsageService } from "../../usage/subscription-usage-service.js";
import type { AgentSuspensionService } from "../agent-suspension.service.js";
import type { PromptQueueRepository } from "../prompt-queue.repository.js";
import type { AppendEntryFn, MessageMirror } from "./message-mirror.js";
import { type ExploreReport, SubagentRunner } from "./subagent-runner.js";
import { composeAgentSystemPrompt } from "./system-prompt-builder.js";
import {
  createToolDraftProgressAccumulator,
  type ToolDraftProgressAccumulator,
} from "./tool-draft-progress.js";
import {
  shouldPublishToolDraftProgress,
  shouldStreamToolDraftArguments,
} from "./tool-draft-streaming.js";

export interface AgentRunnerDeps {
  storage: InitializedStorage;
  events: EventBus;
  auth: AuthManager;
  tools: ToolService;
  pythonRuntime: PythonRuntimeService;
  suspensions: AgentSuspensionService;
  harnessManager: HarnessManager;
  conversationService: ConversationService;
  compactionService: CompactionService;
  state: RuntimeState;
  createAgent: (
    request: CreateAgentRequest,
    options?: { allowChildAuthorityExceed?: boolean },
  ) => Promise<AgentRecord>;
  setAgentStatus: (
    agent: AgentRecord,
    status: AgentRecord["status"],
  ) => Promise<void>;
  appendEntry: AppendEntryFn;
  updateConversation: (conversation: ConversationRecord) => Promise<void>;
  messageMirror: MessageMirror;
  subscriptionUsage: SubscriptionUsageService;
  logger: ApplicationLogger;
  promptQueue: PromptQueueRepository;
}

export class AgentRunner {
  private readonly subagents: SubagentRunner;

  constructor(private readonly deps: AgentRunnerDeps) {
    this.subagents = new SubagentRunner({
      storage: deps.storage,
      events: deps.events,
      auth: deps.auth,
      tools: deps.tools,
      harnessManager: deps.harnessManager,
      state: deps.state,
      createAgent: deps.createAgent,
      setAgentStatus: deps.setAgentStatus,
      appendEntry: deps.appendEntry,
      getConversation: (conversationId) =>
        deps.state.getConversation(conversationId),
      updateConversation: deps.updateConversation,
      subscriptionUsage: deps.subscriptionUsage,
      logger: deps.logger.child({ component: "subagent-runner" }),
    });
  }

  private async activeToolNamesFor(agent: AgentRecord): Promise<ToolName[]> {
    const pythonAvailable = await this.deps.pythonRuntime.isAvailableForProject(
      agent.projectDir,
    );
    return activeToolNamesForAgent(agent, { pythonAvailable });
  }

  async promptAgent(agentId: string, request: PromptRequest): Promise<void> {
    const agent = this.deps.state.agents.get(agentId);
    if (!agent) throw new HttpError(404, "AGENT_NOT_FOUND", "Agent not found.");
    if (agent.status === "awaiting_user") {
      throw new HttpError(
        409,
        "AGENT_AWAITING_USER",
        "Agent is awaiting a human-in-the-loop tool response.",
      );
    }
    const activeRun = this.deps.state.runs.get(agent.id);
    if (activeRun) {
      const behavior = request.behavior ?? "steer";
      if (behavior === "reject-if-busy") {
        throw new HttpError(409, "AGENT_BUSY", "Agent is already running.");
      }
      const callback =
        behavior === "follow-up" ? activeRun.followUp : activeRun.steer;
      if (!callback) {
        throw new HttpError(409, "AGENT_BUSY", "Agent is already running.");
      }
      const queuedPrompt = await this.deps.promptQueue.enqueue({
        agentId: agent.id,
        conversationId: agent.conversationId,
        projectId: agent.projectId,
        runId: activeRun.runId,
        behavior,
        text: request.text,
        images: request.images,
      });
      this.deps.state.conversationRuntime.queuePrompt(
        activeRun.runId,
        queuedPrompt,
      );
      await this.deps.events.publish("conversation.prompt.queued", {
        conversationId: agent.conversationId,
        agentId: agent.id,
        projectId: agent.projectId,
        runId: activeRun.runId,
        queuedPrompt,
      });
      try {
        await callback(request.text, request, queuedPrompt.id);
        const accepted = await this.deps.promptQueue.markAccepted(
          queuedPrompt.id,
          agent.id,
          activeRun.runId,
        );
        if (accepted)
          this.deps.state.conversationRuntime.queuePrompt(
            activeRun.runId,
            accepted,
          );
      } catch (error) {
        await this.deps.promptQueue.markFailed(
          queuedPrompt.id,
          agent.id,
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }
      return;
    }
    void this.runAgentPrompt(agent, request).catch(() => undefined);
  }

  async continueAgent(agentId: string): Promise<void> {
    const agent = this.deps.state.agents.get(agentId);
    if (!agent) throw new HttpError(404, "AGENT_NOT_FOUND", "Agent not found.");
    if (this.deps.state.runs.has(agent.id)) {
      throw new HttpError(409, "AGENT_BUSY", "Agent is already running.");
    }
    void this.runAgentPrompt(
      agent,
      { text: "Continue after resolved tool result." },
      { continue: true },
    ).catch(() => undefined);
  }

  async continueFromFailedTurn(
    agentId: string,
    failedEntryId: string,
  ): Promise<void> {
    const agent = this.deps.state.agents.get(agentId);
    if (!agent) throw new HttpError(404, "AGENT_NOT_FOUND", "Agent not found.");
    if (this.deps.state.runs.has(agent.id)) {
      throw new HttpError(409, "AGENT_BUSY", "Agent is already running.");
    }
    const conversation = this.deps.state.getConversation(agent.conversationId);
    const project = this.deps.state.getProject(agent.projectId);
    const storage = await this.deps.harnessManager.openStorage(
      conversation,
      project.dir,
    );
    const failedEntry = await storage.getEntry(failedEntryId);
    const failedMessage =
      failedEntry?.type === "message" ? failedEntry.message : undefined;
    if (
      !failedEntry ||
      failedEntry.type !== "message" ||
      failedMessage?.role !== "assistant" ||
      failedMessage.stopReason !== "error" ||
      failedEntry.parentId === null
    ) {
      throw new HttpError(
        400,
        "INVALID_FAILED_ENTRY",
        "Failed entry is not a retryable assistant failure.",
      );
    }
    await new Conversation(storage).moveTo(failedEntry.parentId);
    void this.runAgentPrompt(
      agent,
      { text: "Continue from failed model request." },
      { continue: true },
    ).catch(() => undefined);
  }

  async abortAgent(agentId: string): Promise<void> {
    const agent = this.deps.state.agents.get(agentId);
    if (!agent) throw new HttpError(404, "AGENT_NOT_FOUND", "Agent not found.");
    const children = [...this.deps.state.agents.values()].filter(
      (child) => child.parentAgentId === agent.id,
    );
    await Promise.all(children.map((child) => this.abortAgent(child.id)));
    const run = this.deps.state.runs.get(agentId);
    if (!run) return;
    await this.deps.events.publish("agent.abort_requested", {
      agentId,
      runId: run.runId,
    });
    await run.abort();
  }

  runExplore(
    parent: AgentRecord,
    args: Record<string, unknown>,
    options: {
      onProgress?: (update: ExploreProgressUpdate) => void;
      signal?: AbortSignal;
    } = {},
  ): Promise<{
    reports: ExploreReport[];
    contentBlocks: [{ type: "text"; text: string }];
  }> {
    return this.subagents.runExplore(parent, args, options);
  }

  async runAgentPrompt(
    agent: AgentRecord,
    request: PromptRequest,
    options: { continue?: boolean } = {},
  ): Promise<ConversationEntry> {
    if (this.deps.state.runs.has(agent.id)) {
      throw new HttpError(409, "AGENT_BUSY", "Agent is already running.");
    }

    const runId = createId("run");
    const runStartedAt = performance.now();
    let abortRequested = false;
    let lastAssistantEntry: ConversationEntry | undefined;
    let currentTurnId: string | undefined;
    let currentLiveMessageId: string | undefined;
    const liveToolDraftNames = new Map<number, string | undefined>();
    const liveToolDraftProgress = new Map<
      number,
      ToolDraftProgressAccumulator
    >();
    const pendingProviderToolCalls = new Map<
      string,
      { toolName: string; args: Record<string, unknown> }
    >();

    try {
      await this.deps.logger.info("Agent run preparing", {
        agentId: agent.id,
        conversationId: agent.conversationId,
        projectId: agent.projectId,
        runId,
        context: { behavior: request.behavior, continue: options.continue },
      });
      const conversation = this.deps.state.getConversation(
        agent.conversationId,
      );
      const project = this.deps.state.getProject(agent.projectId);
      const storage = await this.deps.harnessManager.openStorage(
        conversation,
        project.dir,
      );
      const harnessConversation = new Conversation(storage);
      const initialHarnessEntryIds = new Set(
        (await storage.getEntries()).map((entry) => entry.id),
      );
      const activeToolNames = await this.activeToolNamesFor(agent);
      const model = resolveAgentModel(agent.model);
      this.deps.subscriptionUsage.touchProvider(model.provider);
      const env = new NodeExecutionEnv({ cwd: agent.projectDir });
      const resources = await loadHarnessResources(agent.projectDir);
      const latestAgent = () => this.deps.state.agents.get(agent.id) ?? agent;
      const composeLatestSystemPrompt = () => {
        const currentAgent = latestAgent();
        const currentActiveToolNames = activeToolNamesForAgent(currentAgent, {
          pythonAvailable: activeToolNames.includes("python"),
        });
        return composeAgentSystemPrompt(
          currentAgent,
          currentActiveToolNames,
          toolPromptMetadata(currentActiveToolNames),
          resources,
          { planDir: planDirForStorageHome(this.deps.storage.paths.home) },
        );
      };

      const harness = new AgentHarness({
        env,
        conversation: harnessConversation,
        resources: { skills: resources.skills },
        tools: createAgentToolsForAgent(agent, this.deps.tools, {
          runId,
          resolveToolAnchor: (providerToolCallId) =>
            this.deps.state.conversationRuntime.resolveToolAnchor(
              runId,
              providerToolCallId,
            ),
        }),
        activeToolNames,
        model,
        thinkingLevel: agent.thinkingLevel,
        getApiKeyAndHeaders: async (requestModel) => {
          if (requestModel.provider === "nerve-faux") return undefined;
          const apiKey = await this.deps.auth.getApiKey(requestModel.provider);
          return apiKey ? { apiKey } : undefined;
        },
        systemPrompt: composeLatestSystemPrompt,
      });

      harness.subscribe(async (event) => {
        if (event.type === "after_provider_response") {
          if (model.provider === "openai-codex") {
            this.deps.subscriptionUsage.applyCodexHeaders(event.headers);
          }
          return;
        }
        if (event.type === "turn_start") {
          const turn = this.deps.state.conversationRuntime.startTurn(runId);
          currentTurnId = turn.turnId;
          currentLiveMessageId = undefined;
          liveToolDraftNames.clear();
          liveToolDraftProgress.clear();
          pendingProviderToolCalls.clear();
          return;
        }
        if (event.type === "tool_execution_start") {
          pendingProviderToolCalls.set(event.toolCallId, {
            toolName: event.toolName,
            args: recordFromUnknown(event.args),
          });
          return;
        }
        if (event.type === "tool_execution_end") {
          const started = pendingProviderToolCalls.get(event.toolCallId);
          pendingProviderToolCalls.delete(event.toolCallId);
          if (!event.isError) return;
          if (
            this.deps.tools.findToolCallByProviderToolCallId(event.toolCallId)
          ) {
            return;
          }
          const parsedToolName = toolNameSchema.safeParse(event.toolName);
          if (!parsedToolName.success) {
            await this.deps.logger.warn(
              "Unknown tool call failed before execution",
              {
                agentId: agent.id,
                conversationId: agent.conversationId,
                projectId: agent.projectId,
                runId,
                context: {
                  toolName: event.toolName,
                  providerToolCallId: event.toolCallId,
                },
              },
            );
            return;
          }
          await this.deps.tools.recordProviderToolCallError(
            agent,
            parsedToolName.data as ToolName,
            started?.args ?? {},
            errorTextFromToolResult(event.result, event.toolName),
            {
              sourceToolCallId: event.toolCallId,
              providerToolCallId: event.toolCallId,
              runId,
              anchor: this.deps.state.conversationRuntime.resolveToolAnchor(
                runId,
                event.toolCallId,
              ),
            },
          );
          return;
        }
        if (
          event.type === "message_start" &&
          event.message.role === "assistant"
        ) {
          if (!currentTurnId) {
            const turn = this.deps.state.conversationRuntime.startTurn(runId);
            currentTurnId = turn.turnId;
          }
          const started =
            this.deps.state.conversationRuntime.startAssistantMessage(
              runId,
              currentTurnId,
            );
          currentLiveMessageId = started.liveMessageId;
          liveToolDraftNames.clear();
          liveToolDraftProgress.clear();
          await this.deps.events.publish(
            "conversation.live.message.started",
            started,
            { durability: "transient" },
          );
          return;
        }
        if (event.type === "message_update") {
          if (!currentTurnId || !currentLiveMessageId) return;
          const update = event.assistantMessageEvent;
          if (update.type === "text_delta") {
            const data = this.deps.state.conversationRuntime.applyContentDelta({
              runId,
              turnId: currentTurnId,
              liveMessageId: currentLiveMessageId,
              contentIndex: update.contentIndex,
              kind: "text",
              delta: update.delta,
            });
            await this.deps.events.publish(
              "conversation.live.content.delta",
              data,
              { durability: "transient" },
            );
          } else if (update.type === "thinking_delta") {
            const data = this.deps.state.conversationRuntime.applyContentDelta({
              runId,
              turnId: currentTurnId,
              liveMessageId: currentLiveMessageId,
              contentIndex: update.contentIndex,
              kind: "thinking",
              delta: update.delta,
            });
            await this.deps.events.publish(
              "conversation.live.content.delta",
              data,
              { durability: "transient" },
            );
          } else if (update.type === "text_end") {
            const data = this.deps.state.conversationRuntime.finishContent({
              runId,
              turnId: currentTurnId,
              liveMessageId: currentLiveMessageId,
              contentIndex: update.contentIndex,
              kind: "text",
              finalText: update.content,
            });
            await this.deps.events.publish(
              "conversation.live.content.done",
              data,
              {
                durability: "transient",
              },
            );
          } else if (update.type === "thinking_end") {
            const data = this.deps.state.conversationRuntime.finishContent({
              runId,
              turnId: currentTurnId,
              liveMessageId: currentLiveMessageId,
              contentIndex: update.contentIndex,
              kind: "thinking",
              finalText: update.content,
              redacted: assistantContentRedacted(
                update.partial,
                update.contentIndex,
              ),
            });
            await this.deps.events.publish(
              "conversation.live.content.done",
              data,
              {
                durability: "transient",
              },
            );
          } else if (update.type === "toolcall_start") {
            const draft = assistantToolCallDraft(
              update.partial,
              update.contentIndex,
            );
            liveToolDraftNames.set(update.contentIndex, draft?.name);
            const progressAccumulator = createToolDraftProgressAccumulator(
              draft?.name,
            );
            if (progressAccumulator) {
              liveToolDraftProgress.set(
                update.contentIndex,
                progressAccumulator,
              );
            }
            const data = this.deps.state.conversationRuntime.startToolDraft({
              runId,
              turnId: currentTurnId,
              liveMessageId: currentLiveMessageId,
              contentIndex: update.contentIndex,
              providerToolCallId: draft?.id,
              toolName: draft?.name,
            });
            await this.deps.events.publish(
              "conversation.live.tool_draft.started",
              data,
              { durability: "transient" },
            );
          } else if (update.type === "toolcall_delta") {
            const draft = assistantToolCallDraft(
              update.partial,
              update.contentIndex,
            );
            const toolName =
              draft?.name ?? liveToolDraftNames.get(update.contentIndex);
            if (draft?.name)
              liveToolDraftNames.set(update.contentIndex, draft.name);
            if (shouldStreamToolDraftArguments(toolName)) {
              const data =
                this.deps.state.conversationRuntime.applyToolDraftDelta({
                  runId,
                  turnId: currentTurnId,
                  liveMessageId: currentLiveMessageId,
                  contentIndex: update.contentIndex,
                  delta: update.delta,
                });
              await this.deps.events.publish(
                "conversation.live.tool_draft.delta",
                data,
                { durability: "transient" },
              );
              return;
            }
            if (!shouldPublishToolDraftProgress(toolName)) return;
            const progressAccumulator =
              liveToolDraftProgress.get(update.contentIndex) ??
              createToolDraftProgressAccumulator(toolName);
            if (!progressAccumulator) return;
            liveToolDraftProgress.set(update.contentIndex, progressAccumulator);
            const progress = progressAccumulator.push(update.delta);
            if (!progress) return;
            const data =
              this.deps.state.conversationRuntime.applyToolDraftProgress({
                runId,
                turnId: currentTurnId,
                liveMessageId: currentLiveMessageId,
                contentIndex: update.contentIndex,
                providerToolCallId: draft?.id,
                toolName,
                progress,
              });
            await this.deps.events.publish(
              "conversation.live.tool_draft.progress",
              data,
              { durability: "transient" },
            );
          } else if (update.type === "toolcall_end") {
            liveToolDraftNames.delete(update.contentIndex);
            liveToolDraftProgress.delete(update.contentIndex);
            const data = this.deps.state.conversationRuntime.finishToolDraft({
              runId,
              turnId: currentTurnId,
              liveMessageId: currentLiveMessageId,
              contentIndex: update.contentIndex,
              providerToolCallId: update.toolCall.id,
              toolName: update.toolCall.name,
              args: update.toolCall.arguments,
            });
            await this.deps.events.publish(
              "conversation.live.tool_draft.done",
              data,
              { durability: "transient" },
            );
          }
          return;
        }
        if (event.type === "message_end") {
          const liveMessageId =
            event.message.role === "assistant"
              ? currentLiveMessageId
              : undefined;
          const mirrored =
            await this.deps.messageMirror.mirrorNewHarnessEntries(
              agent,
              storage,
              initialHarnessEntryIds,
              {
                runId,
                turnId: currentTurnId,
                liveMessageId,
              },
            );
          let shouldPublishContextUsage = false;
          for (const entry of mirrored) {
            await this.deps.events.publish("conversation.entry.appended", {
              conversationId: agent.conversationId,
              agentId: agent.id,
              runId,
              turnId: entry.turnId ?? currentTurnId,
              liveMessageId: entry.liveMessageId,
              entry,
            });
            if (entry.role === "user") {
              await this.maybeMarkQueuedPromptDelivered(agent, runId, entry);
              await this.deps.messageMirror.maybeDeriveInitialConversationTitle(
                conversation.id,
                entry.text,
              );
            } else if (entry.role === "assistant") {
              lastAssistantEntry = entry;
              if (entry.usage) shouldPublishContextUsage = true;
            }
          }
          if (shouldPublishContextUsage) {
            await this.publishContextUsage(
              agent.conversationId,
              agent.id,
              runId,
            ).catch((error) => {
              process.emitWarning(
                `Context-usage publish failed for ${agent.conversationId}: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            });
          }
          if (event.message.role === "assistant")
            currentLiveMessageId = undefined;
          return;
        }
      });

      const startedAt = new Date().toISOString();
      this.deps.state.conversationRuntime.startRun({
        agentId: agent.id,
        projectId: agent.projectId,
        conversationId: agent.conversationId,
        runId,
        startedAt,
      });
      await this.deps.events.publish("conversation.run.started", {
        agentId: agent.id,
        projectId: agent.projectId,
        conversationId: agent.conversationId,
        runId,
        parentEntryId: conversation.activeEntryId,
        startedAt,
      });
      await this.deps.logger.info("Agent run started", {
        agentId: agent.id,
        conversationId: agent.conversationId,
        projectId: agent.projectId,
        runId,
        context: {
          parentEntryId: conversation.activeEntryId,
          model: model.id,
          provider: model.provider,
        },
      });

      this.deps.state.runs.set(agent.id, {
        runId,
        abort: async () => {
          abortRequested = true;
          this.deps.state.conversationRuntime.markAborting(runId);
          await harness.abort();
        },
        messages: this.deps.conversationService.getForAgent(agent.id) ?? [],
        steer: (text, options) =>
          harness.steer(text, { images: options?.images }),
        followUp: (text, options) =>
          harness.steer(text, { images: options?.images }),
        updateAgentRuntimeConfig: async (updatedAgent) => {
          await harness.setActiveTools(
            await this.activeToolNamesFor(updatedAgent),
          );
        },
        appendExternalMessage: (input) => harness.appendExternalMessage(input),
        enqueueHarnessMessage: (input) =>
          harness.enqueueHarnessMessage({
            id: input.id,
            message: input.message,
            timestamp: input.timestamp,
            delivery: input.delivery,
          }),
      });
      await this.deps.setAgentStatus(agent, "running");

      const runAssistant = await this.runHarnessWithRetries({
        harness,
        conversation: harnessConversation,
        request,
        continue: options.continue === true,
        runId,
        agent,
      });
      const latest = this.deps.state.agents.get(agent.id);
      this.deps.state.runs.delete(agent.id);
      const branch = await storage.getPathToRoot(await storage.getLeafId());
      const messages = convertToLlm(buildConversationContext(branch).messages);
      this.deps.conversationService.setForAgent(agent.id, messages);
      const assistantEntry = lastAssistantEntry;
      if (!assistantEntry) {
        throw new Error("Agent run completed without an assistant entry.");
      }
      if (
        runAssistant.stopReason === "error" ||
        runAssistant.stopReason === "aborted"
      ) {
        const aborted = runAssistant.stopReason === "aborted" || abortRequested;
        if (latest)
          await this.deps.setAgentStatus(latest, aborted ? "aborted" : "error");
        const retryExhausted = !aborted
          ? await this.maybeAppendRetryExhaustedStatus(
              agent,
              runId,
              assistantEntry,
              runAssistant,
            )
          : undefined;
        this.deps.state.conversationRuntime.failRun(runId);
        await this.deps.events.publish("conversation.run.failed", {
          agentId: agent.id,
          projectId: agent.projectId,
          runId,
          conversationId: agent.conversationId,
          message: runAssistant.errorMessage ?? "Agent run failed.",
          aborted,
          failedAt: new Date().toISOString(),
          retryExhausted,
        });
        await this.deps.logger.warn("Agent run failed", {
          agentId: agent.id,
          conversationId: agent.conversationId,
          projectId: agent.projectId,
          runId,
          durationMs: Math.round(performance.now() - runStartedAt),
          context: {
            finalEntryId: assistantEntry.id,
            stopReason: runAssistant.stopReason,
            errorMessage: runAssistant.errorMessage,
          },
        });
        return assistantEntry;
      }
      if (latest) await this.deps.setAgentStatus(latest, "idle");
      const completedAt = new Date().toISOString();
      this.deps.state.conversationRuntime.completeRun(runId);
      await this.deps.events.publish("conversation.run.completed", {
        agentId: agent.id,
        projectId: agent.projectId,
        runId,
        conversationId: agent.conversationId,
        finalEntryId: assistantEntry.id,
        completedAt,
      });
      await this.deps.logger.info("Agent run completed", {
        agentId: agent.id,
        conversationId: agent.conversationId,
        projectId: agent.projectId,
        runId,
        durationMs: Math.round(performance.now() - runStartedAt),
        context: { finalEntryId: assistantEntry.id },
      });
      await this.maybeAutoCompact(agent.conversationId, agent.id, runId).catch(
        (error) => {
          process.emitWarning(
            `Auto-compaction failed for ${agent.conversationId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        },
      );
      await this.publishContextUsage(
        agent.conversationId,
        agent.id,
        runId,
      ).catch((error) => {
        process.emitWarning(
          `Context-usage publish failed for ${agent.conversationId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
      return assistantEntry;
    } catch (error) {
      const suspensionError = isAgentToolSuspension(error)
        ? error
        : this.suspensionFromWaitingToolCall(agent, runId, error);
      if (suspensionError) {
        this.deps.state.runs.delete(agent.id);
        const latest = this.deps.state.agents.get(agent.id);
        const toolCall = this.deps.tools.getToolCall(
          suspensionError.data.toolCallId,
        );
        const providerToolCallId =
          toolCall.providerToolCallId ??
          toolCall.sourceToolCallId ??
          suspensionError.data.toolCall?.id ??
          suspensionError.data.toolCallId;
        const suspension = await this.deps.suspensions.createSuspension({
          agentId: agent.id,
          conversationId: agent.conversationId,
          projectId: agent.projectId,
          runId,
          turnId: currentTurnId,
          liveMessageId: currentLiveMessageId,
          assistantEntryId: lastAssistantEntry?.id,
          toolCallId: toolCall.id,
          providerToolCallId,
          toolName: toolCall.toolName as "ask_user" | "plan_mode_present",
          remainingToolCalls: (
            suspensionError.data.remainingToolCalls ?? []
          ).map((remaining) => ({
            id: remaining.id,
            name: remaining.name,
            arguments: remaining.arguments,
          })),
          reason: suspensionError.data.reason,
        });
        if (latest) await this.deps.setAgentStatus(latest, "awaiting_user");
        const suspendedAt = new Date().toISOString();
        this.deps.state.conversationRuntime.completeRun(runId);
        await this.deps.events.publish("conversation.run.suspended", {
          agentId: agent.id,
          projectId: agent.projectId,
          runId,
          conversationId: agent.conversationId,
          suspensionId: suspension.id,
          toolCallId: toolCall.id,
          suspendedAt,
          reason: suspensionError.data.reason,
        });
        await this.deps.logger.info("Agent run suspended", {
          agentId: agent.id,
          conversationId: agent.conversationId,
          projectId: agent.projectId,
          runId,
          toolCallId: toolCall.id,
          durationMs: Math.round(performance.now() - runStartedAt),
          context: {
            suspensionId: suspension.id,
            reason: suspensionError.data.reason,
          },
        });
        if (lastAssistantEntry) return lastAssistantEntry;
        throw new Error("Agent run suspended without an assistant entry.");
      }
      this.deps.state.runs.delete(agent.id);
      const aborted = abortRequested;
      const latest = this.deps.state.agents.get(agent.id);
      if (latest)
        await this.deps.setAgentStatus(latest, aborted ? "aborted" : "error");
      this.deps.state.conversationRuntime.failRun(runId);
      await this.deps.events.publish("conversation.run.failed", {
        agentId: agent.id,
        projectId: agent.projectId,
        runId,
        conversationId: agent.conversationId,
        message: error instanceof Error ? error.message : String(error),
        aborted,
        failedAt: new Date().toISOString(),
      });
      await this.deps.logger[aborted ? "warn" : "error"](
        aborted ? "Agent run aborted" : "Agent run failed",
        {
          agentId: agent.id,
          conversationId: agent.conversationId,
          projectId: agent.projectId,
          runId,
          durationMs: Math.round(performance.now() - runStartedAt),
          context: { aborted },
          error,
        },
      );
      throw error;
    }
  }

  private async maybeAppendRetryExhaustedStatus(
    agent: AgentRecord,
    runId: string,
    assistantEntry: ConversationEntry,
    assistant: AssistantMessage,
  ): Promise<ConversationRunRetryExhaustedData | undefined> {
    const settings = this.deps.storage.settings.retry;
    if (
      !settings.enabled ||
      settings.maxRetries <= 0 ||
      !isRetryableAssistantError(assistant)
    ) {
      return undefined;
    }
    const details = {
      type: "agent_run_retry_status",
      state: "retry_exhausted",
      runId,
      failedEntryId: assistantEntry.id,
      attempt: settings.maxRetries,
      maxRetries: settings.maxRetries,
      errorMessage: assistant.errorMessage,
      retryable: true,
    } satisfies ConversationRunStatusDetails;
    const statusEntry = await this.deps.appendEntry(
      {
        conversationId: agent.conversationId,
        agentId: agent.id,
        runId,
        parentEntryId: assistantEntry.id,
        role: "system",
        kind: "run_status",
        text: `Model request failed after ${settings.maxRetries} ${settings.maxRetries === 1 ? "retry" : "retries"}.`,
        details,
      },
      { mirrorToHarness: false },
    );
    await this.deps.events.publish("conversation.entry.appended", {
      conversationId: agent.conversationId,
      agentId: agent.id,
      projectId: agent.projectId,
      runId,
      entry: statusEntry,
    });
    return {
      statusEntryId: statusEntry.id,
      failedEntryId: details.failedEntryId,
      attempt: details.attempt,
      maxRetries: details.maxRetries,
      errorMessage: details.errorMessage,
      retryable: details.retryable,
    };
  }

  private async runHarnessWithRetries(input: {
    harness: AgentHarness;
    conversation: Conversation;
    request: PromptRequest;
    continue: boolean;
    runId: string;
    agent: AgentRecord;
  }): Promise<AssistantMessage> {
    const settings = this.deps.storage.settings.retry;
    const contextWindow = getModelContextWindow(input.agent.model);
    let attempt = 0;
    let continueRun = input.continue;
    let overflowCompactionAttempted = false;
    while (true) {
      const assistant = continueRun
        ? await input.harness.continue()
        : await input.harness.prompt(input.request.text, {
            images: input.request.images,
          });
      if (
        this.deps.storage.settings.compaction.auto &&
        !overflowCompactionAttempted &&
        isContextOverflowAssistantMessage(assistant, contextWindow)
      ) {
        overflowCompactionAttempted = true;
        const recovered = await this.tryOverflowCompactionRecovery(
          input,
          assistant,
          contextWindow,
        );
        if (recovered) {
          continueRun = true;
          continue;
        }
        return assistant;
      }
      if (
        assistant.stopReason !== "error" ||
        !isRetryableAssistantError(assistant) ||
        !settings.enabled ||
        attempt >= settings.maxRetries
      ) {
        return assistant;
      }
      attempt += 1;
      const delayMs = settings.baseDelayMs * 2 ** (attempt - 1);
      const retryAt = new Date(Date.now() + delayMs).toISOString();
      const leafId = await input.conversation.getLeafId();
      const leaf = leafId
        ? await input.conversation.getEntry(leafId)
        : undefined;
      const failedEntryId = leaf?.type === "message" ? leaf.id : undefined;
      const retry = {
        attempt,
        maxRetries: settings.maxRetries,
        delayMs,
        retryAt,
        errorMessage: assistant.errorMessage,
        failedEntryId,
      };
      this.deps.state.conversationRuntime.markRetrying(input.runId, retry);
      await this.deps.events.publish("conversation.run.retrying", {
        agentId: input.agent.id,
        conversationId: input.agent.conversationId,
        projectId: input.agent.projectId,
        runId: input.runId,
        ...retry,
      });
      await this.deps.logger.warn("Retrying transient agent error", {
        agentId: input.agent.id,
        conversationId: input.agent.conversationId,
        projectId: input.agent.projectId,
        runId: input.runId,
        context: {
          attempt,
          maxRetries: settings.maxRetries,
          errorMessage: assistant.errorMessage,
        },
      });
      if (leaf?.parentId !== undefined)
        await input.conversation.moveTo(leaf.parentId);
      await delay(delayMs);
      this.deps.state.conversationRuntime.clearRetry(input.runId);
      continueRun = true;
    }
  }

  private async tryOverflowCompactionRecovery(
    input: {
      conversation: Conversation;
      runId: string;
      agent: AgentRecord;
    },
    assistant: AssistantMessage,
    contextWindow: number,
  ): Promise<boolean> {
    const leafId = await input.conversation.getLeafId();
    const leaf = leafId ? await input.conversation.getEntry(leafId) : undefined;
    if (!leaf || leaf.type !== "message" || leaf.message.role !== "assistant") {
      return false;
    }
    const failedEntryId = leaf.id;
    const failedParentId = leaf.parentId;
    const policy = deriveAutoCompactionPolicy(
      contextWindow,
      this.deps.storage.settings.compaction.auto,
    );
    try {
      await input.conversation.moveTo(failedParentId);
      await this.deps.compactionService.compactConversation(
        input.agent.conversationId,
        {
          instructions:
            "Overflow recovery after the selected model hit its context limit.",
        },
        {
          reason: "overflow",
          agentId: input.agent.id,
          runId: input.runId,
          contextWindow: policy.contextWindow,
          contextTokens: calculateContextTokens(assistant.usage),
          thresholdTokens: policy.thresholdTokens,
          triggerReserveTokens: policy.triggerReserveTokens,
          keepRecentTokens: policy.keepRecentTokens,
          failedEntryId,
        },
      );
      await this.deps.logger.info(
        "Recovered context overflow with compaction",
        {
          agentId: input.agent.id,
          conversationId: input.agent.conversationId,
          projectId: input.agent.projectId,
          runId: input.runId,
          context: { failedEntryId, contextWindow: policy.contextWindow },
        },
      );
      return true;
    } catch (error) {
      await input.conversation.moveTo(failedEntryId).catch(() => undefined);
      await this.deps.logger.warn("Context overflow compaction failed", {
        agentId: input.agent.id,
        conversationId: input.agent.conversationId,
        projectId: input.agent.projectId,
        runId: input.runId,
        context: { failedEntryId },
        error,
      });
      return false;
    }
  }

  private async maybeMarkQueuedPromptDelivered(
    agent: AgentRecord,
    runId: string,
    entry: ConversationEntry,
  ): Promise<void> {
    const queuedPrompt = (await this.deps.promptQueue.pendingForAgent(agent.id))
      .filter(
        (candidate) =>
          candidate.runId === runId &&
          (candidate.status === "accepted" || candidate.status === "queued") &&
          candidate.text === entry.text,
      )
      .at(0);
    if (!queuedPrompt) return;
    const delivered = await this.deps.promptQueue.markDelivered(
      queuedPrompt.id,
      agent.id,
      entry.id,
    );
    if (!delivered) return;
    this.deps.state.conversationRuntime.removeQueuedPrompt(runId, delivered.id);
    await this.deps.events.publish("conversation.prompt.dequeued", {
      conversationId: agent.conversationId,
      agentId: agent.id,
      projectId: agent.projectId,
      runId,
      queuedPrompt: delivered,
      entryId: entry.id,
    });
  }

  private suspensionFromWaitingToolCall(
    agent: AgentRecord,
    runId: string,
    error: unknown,
  ): AgentToolSuspension | undefined {
    const message = error instanceof Error ? error.message : String(error);
    const toolCall = this.deps.tools
      .listToolCalls()
      .find(
        (candidate) =>
          candidate.agentId === agent.id &&
          candidate.runId === runId &&
          candidate.status === "waiting_for_user" &&
          (candidate.toolName === "ask_user" ||
            candidate.toolName === "plan_mode_present"),
      );
    if (!toolCall) return undefined;
    return new AgentToolSuspension({
      toolCallId: toolCall.id,
      toolName: toolCall.toolName,
      reason: message || `Tool ${toolCall.toolName} is awaiting user input.`,
      remainingToolCalls: [],
    });
  }

  /** Compute compaction-aware context-window usage for a conversation. */
  async getContextUsage(conversationId: string): Promise<ContextUsage> {
    const conversation = this.deps.state.getConversation(conversationId);
    const project = this.deps.state.getProject(conversation.projectId);
    const storage = await this.deps.harnessManager.openStorage(
      conversation,
      project.dir,
    );
    const branch = await storage.getPathToRoot(await storage.getLeafId());
    const messages = buildConversationContext(branch).messages;
    const agent = conversation.activeAgentId
      ? this.deps.state.agents.get(conversation.activeAgentId)
      : undefined;
    const contextWindow = getModelContextWindow(agent?.model);
    return computeContextUsage(messages, branch, contextWindow);
  }

  private async publishContextUsage(
    conversationId: string,
    agentId: string,
    runId: string,
  ): Promise<void> {
    const contextUsage = await this.getContextUsage(conversationId);
    await this.deps.events.publish(
      "conversation.context.updated",
      { conversationId, agentId, runId, contextUsage },
      { durability: "transient" },
    );
  }

  private async maybeAutoCompact(
    conversationId: string,
    agentId?: string,
    runId?: string,
  ): Promise<void> {
    if (!this.deps.storage.settings.compaction.auto) return;
    const conversation = this.deps.state.getConversation(conversationId);
    const agent =
      (agentId ? this.deps.state.agents.get(agentId) : undefined) ??
      (conversation.activeAgentId
        ? this.deps.state.agents.get(conversation.activeAgentId)
        : undefined);
    const contextWindow = getModelContextWindow(agent?.model);
    if (contextWindow <= 0) return;

    const project = this.deps.state.getProject(conversation.projectId);
    const storage = await this.deps.harnessManager.openStorage(
      conversation,
      project.dir,
    );
    const branch = await storage.getPathToRoot(await storage.getLeafId());
    const messages = buildConversationContext(branch).messages;
    const contextUsage = computeContextUsage(messages, branch, contextWindow);
    if (contextUsage.tokens === null) return;

    const policy = deriveAutoCompactionPolicy(
      contextWindow,
      this.deps.storage.settings.compaction.auto,
    );
    if (!shouldAutoCompact(contextUsage.tokens, policy)) return;
    await this.deps.compactionService.compactConversation(
      conversationId,
      {
        instructions:
          "Automatic compaction after the selected model approached its context window.",
      },
      {
        reason: "threshold",
        agentId: agent?.id,
        runId,
        contextWindow: policy.contextWindow,
        contextTokens: contextUsage.tokens,
        thresholdTokens: policy.thresholdTokens,
        triggerReserveTokens: policy.triggerReserveTokens,
        keepRecentTokens: policy.keepRecentTokens,
      },
    );
  }
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function errorTextFromToolResult(result: unknown, toolName: string): string {
  const record = recordFromUnknown(result);
  const content = Array.isArray(record.content) ? record.content : [];
  const text = content
    .map((part) => {
      const partRecord = recordFromUnknown(part);
      return partRecord.type === "text" && typeof partRecord.text === "string"
        ? partRecord.text
        : "";
    })
    .filter(Boolean)
    .join("\n");
  return text.trim() || `Tool ${toolName} failed before execution.`;
}

function isRetryableAssistantError(message: AssistantMessage): boolean {
  if (message.stopReason !== "error" || !message.errorMessage) return false;
  const error = message.errorMessage;
  if (
    /GoUsageLimitError|FreeUsageLimitError|Monthly usage limit reached|available balance|insufficient_quota|out of budget|quota exceeded|billing|context.?length|context.?window|maximum context|too many tokens/i.test(
      error,
    )
  ) {
    return false;
  }
  return /overloaded|provider.?returned.?error|rate.?limit|too many requests|429|500|502|503|504|service.?unavailable|server.?error|internal.?error|network.?error|connection.?error|connection.?refused|connection.?lost|websocket.?closed|websocket.?error|other side closed|fetch failed|upstream.?connect|reset before headers|socket hang up|ended without|stream ended before message_stop|http2 request did not get a response|timed? out|timeout|terminated|retry delay/i.test(
    error,
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assistantContentRedacted(
  message: AssistantMessage,
  contentIndex: number,
): boolean | undefined {
  const block = message.content[contentIndex];
  return block?.type === "thinking" ? block.redacted : undefined;
}

function assistantToolCallDraft(
  message: AssistantMessage,
  contentIndex: number,
): { id?: string; name?: string } | undefined {
  const block = message.content[contentIndex];
  return block?.type === "toolCall"
    ? { id: block.id, name: block.name }
    : undefined;
}
