import {
  AgentHarness,
  type AnyModel,
  buildConversationContext,
  Conversation,
  convertToLlm,
  HostHarnessFactory,
  isAgentToolSuspension,
  NodeExecutionEnv,
  resolveAgentModel,
} from "@nervekit/host-runtime/harness";
import type {
  AgentRecord,
  ConversationEntry,
  PromptRequest,
  RunRecord,
  ToolName,
} from "@nervekit/contracts";
import type {
  CheckpointCommand,
  RunExecutionOutcome,
  RunExecutionSink,
} from "@nervekit/host-runtime";
import { toolNameSchema } from "@nervekit/contracts";
import { planDirForStorageHome } from "../../plans/plan-paths.js";
import {
  activeToolNamesForAgent,
  createAgentToolsForAgent,
  toolPromptMetadata,
} from "../../tools/agent-tool-adapter.js";
import {
  toPublicToolCallArgsPreview,
  toToolCallTranscriptRecord,
} from "../../tools/tool-call-transcript-preview.js";
import type { WorkbenchLiveExecutionControl } from "../../runs/run-live-executions.js";
import { loadHarnessResources } from "../prompting/resource-loader.js";
import type { WorkbenchAgentMechanics } from "./workbench-agent-mechanics.js";
import {
  assistantContentRedacted,
  assistantToolCallDraft,
  errorTextFromToolResult,
  recordFromUnknown,
  sameStringList,
  isRetryableAssistantError,
} from "./harness-execution-shared.js";
import { expandExecutablePromptBlocks } from "./prompt-block-expansion.js";
import { waitForSequentialToolInteractionBatch } from "./sequential-tool-approval-batch.js";
import {
  LiveToolDraftReconciler,
  type LiveToolDraftState,
} from "./live-tool-draft-reconciliation.js";
import {
  AssistantEntryMetaQueue,
  markMirroredEntriesMaterialized,
} from "./message-mirror.js";
import { composeAgentSystemPrompt } from "./system-prompt-builder.js";
import {
  createToolDraftProgressAccumulator,
  type ToolDraftProgressAccumulator,
} from "./tool-draft-progress.js";
import {
  shouldPublishToolDraftProgress,
  shouldStreamToolDraftArguments,
} from "./tool-draft-streaming.js";
interface CoordinatorExecutionOptions {
  run: RunRecord;
  sink: RunExecutionSink;
  command: "start" | "continue";
  prompt?: string;
  images?: PromptRequest["images"];
  signal: AbortSignal;
  installControl(control: WorkbenchLiveExecutionControl): void;
  checkpointCommand(
    boundary: CheckpointCommand["boundary"],
    interactionId?: string,
  ): Promise<CheckpointCommand>;
}

export async function executeWorkbenchHarness(
  this: WorkbenchAgentMechanics,
  agent: AgentRecord,
  request: PromptRequest,
  options: {
    continue?: boolean;
    coordinator: CoordinatorExecutionOptions;
  },
): Promise<RunExecutionOutcome> {
  const coordinator = options.coordinator;
  const runId = coordinator.run.runId;
  let abortRequested = false;
  const runAbortController = new AbortController();
  if (coordinator.signal.aborted) runAbortController.abort();
  coordinator.signal.addEventListener(
    "abort",
    () => runAbortController.abort(),
    { once: true },
  );
  let lastAssistantEntry: ConversationEntry | undefined;
  let currentTurnId: string | undefined;
  let currentLiveMessageId: string | undefined;
  const assistantEntryMeta = new AssistantEntryMetaQueue();
  const liveToolDraftNames = new Map<number, string | undefined>();
  const liveToolDraftProgress = new Map<number, ToolDraftProgressAccumulator>();
  const liveToolDrafts = new Map<number, LiveToolDraftState>();
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
    const conversation = this.deps.state.getConversation(agent.conversationId);
    const project = this.deps.state.getProject(agent.projectId);
    const storage = await this.deps.harnessStorage.openStorage(
      conversation,
      project.dir,
    );
    const harnessConversation = new Conversation(storage);
    const initialHarnessEntryIds = new Set(
      (await storage.getEntries()).map((entry) => entry.id),
    );
    let activeToolNames = await this.activeToolNamesFor(agent);
    const model = resolveAgentModel(agent.model);
    this.deps.subscriptionUsage.touchProvider(model.provider);
    const shellPath = this.deps.storage.settings.runtime.shellPath;
    const env = new NodeExecutionEnv({ cwd: agent.projectDir, shellPath });
    const resources = await loadHarnessResources(agent.projectDir, {
      storageHome: this.deps.storage.paths.home,
      disabledSkillNames: this.deps.storage.settings.skills.disabled,
      enabledAgentBrowserSkillNames:
        this.deps.storage.settings.skills.agentBrowser.enabled,
      agentBrowserSkills: this.deps.agentBrowserSkills.skills,
    });
    const latestAgent = () => this.deps.state.agents.get(agent.id) ?? agent;
    const composeLatestSystemPrompt = () => {
      const currentAgent = latestAgent();
      const currentActiveToolNames = activeToolNamesForAgent(currentAgent, {
        pythonAvailable: activeToolNames.includes("python_exec"),
        disabledToolNames: this.deps.storage.settings.tools.disabled,
        jiraEnabled: this.deps.storage.settings.tools.jira.enabled,
        confluenceEnabled: this.deps.storage.settings.tools.confluence.enabled,
      });
      return composeAgentSystemPrompt(
        currentAgent,
        currentActiveToolNames,
        toolPromptMetadata(currentActiveToolNames),
        resources,
        {
          planDir: planDirForStorageHome(this.deps.storage.paths.home),
          tasks: this.deps.tasks.listTasks(),
        },
      );
    };
    const liveToolDraftReconciler = new LiveToolDraftReconciler({
      conversationRuntime: this.deps.state.conversationRuntime,
      publish: async (type, data) => {
        await this.deps.events.publish(type, data);
      },
      runId,
      getTurnId: () => currentTurnId,
      getLiveMessageId: () => currentLiveMessageId,
    });
    let currentProviderForResponse: string | undefined;
    const harnessFactory = new HostHarnessFactory({
      resolveModel: async () => model,
      resolveCredentials: async () => (requestModel: AnyModel) =>
        this.deps.auth.requestAuthForPiModel(requestModel),
      resolvePolicy: async () => ({
        tools: createAgentToolsForAgent(agent, this.deps.tools, {
          runId,
          resolveToolAnchor: (providerToolCallId) =>
            this.deps.state.conversationRuntime.resolveToolAnchor(
              runId,
              providerToolCallId,
            ),
          onLifecycle: (toolCall) =>
            coordinator.sink.upsertToolCalls([
              toToolCallTranscriptRecord(toolCall),
            ]),
        }),
        activeToolNames,
      }),
      create: async ({ environment }) =>
        new AgentHarness({
          env,
          conversation: harnessConversation,
          resources: { skills: resources.skills },
          tools: environment.policy.tools,
          activeToolNames: environment.policy.activeToolNames,
          model: environment.model,
          thinkingLevel: agent.thinkingLevel,
          getApiKeyAndHeaders: environment.credentials,
          systemPrompt: composeLatestSystemPrompt,
        }),
    });
    const harness = await harnessFactory.create({
      scope: { conversationId: conversation.id, agentId: agent.id, runId },
      context: undefined,
    });
    harness.on("iteration_boundary", async (event) => {
      const compacted = await this.maybeAutoCompactAtIteration(
        agent.conversationId,
        agent.id,
        runId,
      );
      if (!compacted || event.hasMoreToolCalls) return undefined;
      const hadToolCalls = event.message.content.some(
        (content) => content.type === "toolCall",
      );
      if (hadToolCalls) return undefined;
      const followUp = this.takeAutoCompactionContinuation(runId);
      return followUp ? { followUp } : undefined;
    });
    const startLiveTurn = async () => {
      const turn = this.deps.state.conversationRuntime.startTurn(runId);
      currentTurnId = turn.turnId;
      await this.deps.events.publish("conversation.live.turn.started", {
        conversationId: conversation.id,
        agentId: agent.id,
        projectId: project.id,
        runId,
        turnId: turn.turnId,
        ordinal: turn.ordinal,
      });
      return turn.turnId;
    };
    harness.subscribe(async (event) => {
      if (event.type === "queue_drained") {
        for (const promptId of event.messageIds) {
          await coordinator.sink.promptDelivered(promptId);
        }
        return;
      }
      if (event.type === "before_provider_request") {
        currentProviderForResponse = event.model.provider;
        this.deps.subscriptionUsage.touchProvider(event.model.provider);
        return;
      }
      if (event.type === "after_provider_response") {
        const responseProvider = currentProviderForResponse;
        currentProviderForResponse = undefined;
        if (responseProvider === "openai-codex") {
          this.deps.subscriptionUsage.applyCodexHeaders(event.headers);
        }
        return;
      }
      if (event.type === "turn_start") {
        coordinator.installControl(liveControl);
        await startLiveTurn();
        currentLiveMessageId = undefined;
        liveToolDraftNames.clear();
        liveToolDraftProgress.clear();
        liveToolDrafts.clear();
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
        const existingToolCall =
          this.deps.tools.findToolCallByProviderToolCallId(event.toolCallId);
        if (!event.isError) return;
        if (existingToolCall) return;
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
        const turnId = currentTurnId ?? (await startLiveTurn());
        const started =
          this.deps.state.conversationRuntime.startAssistantMessage(
            runId,
            turnId,
          );
        currentLiveMessageId = started.liveMessageId;
        assistantEntryMeta.onMessageStarted(started);
        liveToolDraftNames.clear();
        liveToolDraftProgress.clear();
        liveToolDrafts.clear();
        await this.deps.events.publish(
          "conversation.live.message.started",
          started,
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
          );
        } else if (update.type === "toolcall_start") {
          const draft = assistantToolCallDraft(
            update.partial,
            update.contentIndex,
          );
          liveToolDraftNames.set(update.contentIndex, draft?.name);
          liveToolDrafts.set(update.contentIndex, {
            contentIndex: update.contentIndex,
            providerToolCallId: draft?.id,
            toolName: draft?.name,
            ended: false,
          });
          const progressAccumulator = createToolDraftProgressAccumulator(
            draft?.name,
          );
          if (progressAccumulator) {
            liveToolDraftProgress.set(update.contentIndex, progressAccumulator);
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
          if (draft?.id || draft?.name) {
            const current = liveToolDrafts.get(update.contentIndex) ?? {
              contentIndex: update.contentIndex,
              ended: false,
            };
            liveToolDrafts.set(update.contentIndex, {
              ...current,
              providerToolCallId: draft.id ?? current.providerToolCallId,
              toolName: draft.name ?? current.toolName,
            });
          }
          if (shouldStreamToolDraftArguments(toolName)) {
            const data =
              this.deps.state.conversationRuntime.applyToolDraftDelta({
                runId,
                turnId: currentTurnId,
                liveMessageId: currentLiveMessageId,
                contentIndex: update.contentIndex,
                providerToolCallId: draft?.id,
                toolName,
                delta: update.delta,
              });
            await this.deps.events.publish(
              "conversation.live.tool_draft.delta",
              data,
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
          );
        } else if (update.type === "toolcall_end") {
          liveToolDraftNames.delete(update.contentIndex);
          liveToolDraftProgress.delete(update.contentIndex);
          liveToolDrafts.set(update.contentIndex, {
            ...(liveToolDrafts.get(update.contentIndex) ?? {
              contentIndex: update.contentIndex,
            }),
            providerToolCallId: update.toolCall.id,
            toolName: update.toolCall.name,
            ended: true,
          });
          const data = this.deps.state.conversationRuntime.finishToolDraft({
            runId,
            turnId: currentTurnId,
            liveMessageId: currentLiveMessageId,
            contentIndex: update.contentIndex,
            providerToolCallId: update.toolCall.id,
            toolName: update.toolCall.name,
            args: toPublicToolCallArgsPreview(update.toolCall.arguments),
          });
          await this.deps.events.publish(
            "conversation.live.tool_draft.done",
            data,
          );
        }
        return;
      }
      if (event.type === "message_end") {
        if (event.message.role === "assistant" && liveToolDrafts.size > 0) {
          await liveToolDraftReconciler.reconcile(event.message, [
            ...liveToolDrafts.values(),
          ]);
          liveToolDrafts.clear();
          liveToolDraftNames.clear();
          liveToolDraftProgress.clear();
        }
        assistantEntryMeta.onMessageEnded(event.message.role);
        const mirrored = await this.deps.messageMirror.mirrorNewHarnessEntries(
          agent,
          storage,
          initialHarnessEntryIds,
          {
            runId,
            turnId: currentTurnId,
            assistantMessageMeta: assistantEntryMeta.queue,
          },
        );
        let shouldPublishContextUsage = false;
        if (mirrored.length > 0) {
          await coordinator.sink.appendEntries(mirrored);
        }
        markMirroredEntriesMaterialized(
          this.deps.state.conversationRuntime,
          runId,
          mirrored,
        );
        for (const entry of mirrored) {
          if (entry.role === "user") {
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
        if (
          event.message.role === "assistant" &&
          currentTurnId &&
          currentLiveMessageId
        ) {
          if (
            event.message.stopReason === "error" ||
            event.message.stopReason === "aborted"
          ) {
            this.deps.state.conversationRuntime.failAssistantMessage(
              runId,
              currentTurnId,
              currentLiveMessageId,
            );
          } else {
            this.deps.state.conversationRuntime.completeAssistantMessage(
              runId,
              currentTurnId,
              currentLiveMessageId,
            );
          }
          currentLiveMessageId = undefined;
        }
        return;
      }
      if (event.type === "turn_end" && currentTurnId) {
        if (
          event.message.role === "assistant" &&
          (event.message.stopReason === "error" ||
            event.message.stopReason === "aborted")
        ) {
          this.deps.state.conversationRuntime.failTurn(runId, currentTurnId);
        } else {
          this.deps.state.conversationRuntime.completeTurn(
            runId,
            currentTurnId,
          );
        }
        currentTurnId = undefined;
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
    const abort = async () => {
      abortRequested = true;
      this.deps.state.conversationRuntime.markAborting(runId);
      runAbortController.abort();
      await harness.abort();
    };
    const updateAgentRuntimeConfig = async (updatedAgent: AgentRecord) => {
      const nextActiveToolNames = await this.activeToolNamesFor(updatedAgent);
      if (!sameStringList(nextActiveToolNames, activeToolNames)) {
        activeToolNames = nextActiveToolNames;
        await harness.setActiveTools(nextActiveToolNames);
      }
      const nextModel = resolveAgentModel(updatedAgent.model);
      const currentModel = harness.getModel();
      if (
        currentModel.provider !== nextModel.provider ||
        currentModel.id !== nextModel.id
      ) {
        await harness.setModel(nextModel);
      }
      if (harness.getThinkingLevel() !== updatedAgent.thinkingLevel) {
        await harness.setThinkingLevel(updatedAgent.thinkingLevel);
      }
    };
    // Expand `!!!` command blocks at harness-delivery time so steered and
    // queued prompts get the same command semantics as run-starting prompts.
    const expandBlocks = (text: string, images?: PromptRequest["images"]) =>
      expandExecutablePromptBlocks(
        (command, opts) =>
          this.executeInlinePromptBlockCommand(agent, command, opts),
        { text, images },
        runAbortController.signal,
      );
    const liveControl: WorkbenchLiveExecutionControl = {
      steer: async (prompt) => {
        const expanded = await expandBlocks(prompt.text, prompt.images);
        return harness.steer(expanded.text, {
          id: prompt.id,
          images: prompt.images,
        });
      },
      followUp: async (prompt) => {
        const expanded = await expandBlocks(prompt.text, prompt.images);
        return harness.followUp(expanded.text, {
          id: prompt.id,
          images: prompt.images,
        });
      },
      continue: async () => undefined,
      cancel: abort,
      removeQueuedPrompt: harness.removeQueuedMessage.bind(harness),
      updateAgentRuntimeConfig,
      appendExternalMessage: (input) => harness.appendExternalMessage(input),
      enqueueHarnessMessage: (input) =>
        harness.enqueueHarnessMessage({
          id: input.id,
          message: input.message,
          timestamp: input.timestamp,
          delivery: input.delivery,
        }),
    };

    const promptRequest = await expandBlocks(request.text, request.images);
    const runAssistant = await this.runHarnessAttempt({
      harness,
      conversation: harnessConversation,
      request: promptRequest,
      continue: options.continue === true,
      runId,
      agent,
    });
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
      const retryable = !aborted && isRetryableAssistantError(runAssistant);
      // Automatic retry policy and manual recovery are intentionally separate:
      // billing/auth failures should not spin, but users can change models and
      // resume from the provider boundary.
      const continuable = !aborted;
      if (continuable) {
        const leafId = await harnessConversation.getLeafId();
        const leaf = leafId
          ? await harnessConversation.getEntry(leafId)
          : undefined;
        if (leaf?.parentId !== undefined) {
          await harnessConversation.moveTo(leaf.parentId);
        }
        await coordinator.sink.checkpoint(
          await coordinator.checkpointCommand("before_provider_request"),
        );
      }
      return {
        status: aborted ? "interrupted" : "failed",
        ...(aborted
          ? { message: "Agent run aborted." }
          : {
              failure: {
                code: "MODEL_REQUEST_FAILED",
                message: runAssistant.errorMessage ?? "Agent run failed.",
                retryable,
                continuable,
              },
            }),
      } as RunExecutionOutcome;
    }
    await coordinator.sink.checkpoint(
      await coordinator.checkpointCommand("after_provider_response"),
    );
    return {
      status: "completed",
      result: { finalEntryId: assistantEntry.id },
    };
  } catch (error) {
    if (isAgentToolSuspension(error)) {
      await waitForSequentialToolInteractionBatch({
        agent,
        runId,
        suspension: error.data,
        deps: this.deps,
        sink: coordinator.sink,
        checkpointCommand: (boundary, interactionId) =>
          coordinator.checkpointCommand(boundary, interactionId),
      });
      return { status: "suspended" };
    }
    return abortRequested
      ? { status: "interrupted", message: "Agent run aborted." }
      : {
          status: "failed",
          failure: {
            code: "EXECUTION_FAILED",
            message: error instanceof Error ? error.message : String(error),
            retryable: true,
          },
        };
  } finally {
    this.finishAutoCompactionRun?.(runId);
  }
}
