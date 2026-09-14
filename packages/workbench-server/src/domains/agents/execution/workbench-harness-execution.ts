import { AgentHarness } from "@nervekit/harness";
import { type AnyModel, isAgentToolSuspension } from "@nervekit/harness/agent";
import { resolveAgentModel } from "@nervekit/harness/models";
import { NodeExecutionEnv } from "@nervekit/harness/node";
import type { AgentRecord, PromptRequest } from "@nervekit/contracts/agents";
import type { ConversationEntry } from "@nervekit/contracts/conversations";
import { toolNameSchema, type ToolName } from "@nervekit/contracts/tools";
import { HostHarnessFactory } from "./harness-factory.js";
import type { RunExecutionOutcome } from "../../runs/runtime/index.js";
import { planDirForStorageHome } from "../../plans/plan-paths.js";
import { createAgentToolsForAgent } from "../../tools/orchestration/agent-tool-adapter.js";
import {
  toPublicToolCallArgsPreview,
  toToolCallTranscriptRecord,
} from "../../tools/artifacts/tool-call-transcript-preview.js";
import { loadHarnessResources } from "../prompting/resource-loader.js";
import type { WorkbenchLiveExecutionControl } from "../../runs/application/run-live-executions.js";
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
} from "./canonical-harness-projection.js";
import { openHarnessExecutionContext } from "./canonical-harness-message-flush.js";
import {
  checkpointLegacyProviderResponse,
  prepareCanonicalHarnessProviderDispatch,
  settleCanonicalHarnessMessage,
} from "./canonical-harness-provider-lifecycle.js";
import type { CoordinatorExecutionOptions } from "./coordinator-execution-options.js";
import { composeAgentSystemPrompt } from "./system-prompt-builder.js";
import {
  createToolDraftProgressAccumulator,
  type ToolDraftProgressAccumulator,
} from "./tool-draft-progress.js";
import { ToolDraftProgressScheduler } from "./tool-draft-progress-scheduler.js";
import {
  shouldPublishToolDraftProgress,
  shouldStreamToolDraftArguments,
} from "./tool-draft-streaming.js";
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
  const canonical = coordinator.canonical;
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
    const settings = await this.effectiveSettings(agent.projectDir);
    const capabilitySelection = await this.deps.capabilities.resolve(
      agent.projectId,
      agent.conversationId,
    );
    const project = this.deps.state.getProject(agent.projectId);
    const [, harnessConversation] = await openHarnessExecutionContext({
      canonical: canonical?.session,
      openLegacy: () =>
        this.deps.openLegacyStorage?.(conversation) ??
        Promise.reject(new Error("Legacy harness execution is retired.")),
    });
    let activeToolNames = canonical
      ? [...canonical.activeToolNames]
      : await this.activeToolNamesFor(agent, capabilitySelection.disabledTools);
    const model = resolveAgentModel(
      agent.model,
      await this.customModels(agent.projectDir),
    );
    this.deps.subscriptionUsage.touchProvider(model.provider);
    const shellPath = settings.runtime.shellPath;
    const env = new NodeExecutionEnv({ cwd: agent.projectDir, shellPath });
    const resources = await loadHarnessResources(agent.projectDir, {
      storageHome: this.deps.storage.paths.home,
      disabledSkillNames: capabilitySelection.disabledFileSkills,
      enabledAgentBrowserSkillNames:
        capabilitySelection.enabledAgentBrowserSkills,
      agentBrowserSkills: this.deps.agentBrowserSkills.skills,
    });
    const latestAgent = () => this.deps.state.agents.get(agent.id) ?? agent;
    const composeLatestSystemPrompt = () => {
      const currentAgent = latestAgent();
      const currentActiveToolNames = activeToolNames;
      return composeAgentSystemPrompt(
        currentAgent,
        currentActiveToolNames,
        resources,
        {
          planDir: planDirForStorageHome(this.deps.storage.paths.home),
        },
      );
    };
    const liveToolDraftReconciler = new LiveToolDraftReconciler({
      conversationRuntime: this.deps.state.conversationRuntime,
      publish: (type, data) => {
        this.deps.events.publishBestEffort(type, data, type);
        return Promise.resolve();
      },
      runId,
      getTurnId: () => currentTurnId,
      getLiveMessageId: () => currentLiveMessageId,
    });
    const toolDraftProgressScheduler = new ToolDraftProgressScheduler(
      liveToolDraftProgress,
      (contentIndex, progress) => {
        if (!currentTurnId || !currentLiveMessageId) return;
        const draft = liveToolDrafts.get(contentIndex);
        const data = this.deps.state.conversationRuntime.applyToolDraftProgress(
          {
            runId,
            turnId: currentTurnId,
            liveMessageId: currentLiveMessageId,
            contentIndex,
            providerToolCallId: draft?.providerToolCallId,
            toolName: draft?.toolName ?? liveToolDraftNames.get(contentIndex),
            progress,
          },
        );
        this.deps.events.publishBestEffort(
          "conversation.live.tool_draft.progress",
          data,
          "conversation.live.tool_draft.progress",
        );
      },
    );
    let currentProviderForResponse: string | undefined;
    const harnessFactory = new HostHarnessFactory({
      resolveModel: async () => model,
      resolveCredentials: async () => (requestModel: AnyModel) =>
        this.deps.auth.requestAuthForPiModel(requestModel),
      resolvePolicy: async () => ({
        tools:
          canonical?.tools ??
          createAgentToolsForAgent(agent, this.deps.tools, {
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
          maxParallelToolCalls: this.deps.maxParallelToolsPerRun,
          stopAfterToolIteration: Boolean(canonical),
          ...(canonical ? { streamOptions: { maxRetries: 0 } } : {}),
          getApiKeyAndHeaders: environment.credentials,
          systemPrompt: composeLatestSystemPrompt,
        }),
    });
    const harness = await harnessFactory.create({
      scope: { conversationId: conversation.id, agentId: agent.id, runId },
      context: undefined,
    });
    harness.on("before_provider_request", (event) => {
      currentProviderForResponse = event.model.provider;
      this.deps.subscriptionUsage.touchProvider(event.model.provider);
      return undefined;
    });
    if (canonical) {
      harness.on("before_provider_payload", async (event) => {
        await prepareCanonicalHarnessProviderDispatch(canonical, event.payload);
        return undefined;
      });
    }
    harness.on("after_provider_response", (event) => {
      const responseProvider = currentProviderForResponse;
      currentProviderForResponse = undefined;
      if (responseProvider === "openai-codex") {
        this.deps.subscriptionUsage.applyCodexHeaders(event.headers);
      }
      return undefined;
    });
    harness.on("iteration_boundary", async (event) => {
      if (canonical) return undefined;
      const compacted = await this.maybeAutoCompactAtIteration(
        agent.conversationId,
        agent.id,
        runId,
        harnessConversation,
        event.signal,
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
      this.deps.events.publishBestEffort(
        "conversation.live.turn.started",
        {
          conversationId: conversation.id,
          agentId: agent.id,
          projectId: project.id,
          runId,
          turnId: turn.turnId,
          ordinal: turn.ordinal,
        },
        "conversation.live.turn.started",
      );
      return turn.turnId;
    };
    harness.subscribe(async (event) => {
      if (event.type === "queue_drained") {
        for (const promptId of event.messageIds)
          await coordinator.sink.promptDelivered(promptId);
      }
      if (event.type === "turn_start") {
        coordinator.installControl(liveControl);
        await startLiveTurn();
        currentLiveMessageId = undefined;
        liveToolDraftNames.clear();
        toolDraftProgressScheduler.clear();
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
        toolDraftProgressScheduler.clear();
        liveToolDrafts.clear();
        this.deps.events.publishBestEffort(
          "conversation.live.message.started",
          started,
          "conversation.live.message.started",
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
          this.deps.events.publishBestEffort(
            "conversation.live.content.delta",
            data,
            "conversation.live.content.delta",
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
          this.deps.events.publishBestEffort(
            "conversation.live.content.delta",
            data,
            "conversation.live.content.delta",
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
          this.deps.events.publishBestEffort(
            "conversation.live.content.done",
            data,
            "conversation.live.content.done",
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
          this.deps.events.publishBestEffort(
            "conversation.live.content.done",
            data,
            "conversation.live.content.done",
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
          this.deps.events.publishBestEffort(
            "conversation.live.tool_draft.started",
            data,
            "conversation.live.tool_draft.started",
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
            this.deps.events.publishBestEffort(
              "conversation.live.tool_draft.delta",
              data,
              "conversation.live.tool_draft.delta",
            );
            return;
          }
          if (!shouldPublishToolDraftProgress(toolName)) return;
          const progressAccumulator =
            liveToolDraftProgress.get(update.contentIndex) ??
            createToolDraftProgressAccumulator(toolName);
          if (!progressAccumulator) return;
          liveToolDraftProgress.set(update.contentIndex, progressAccumulator);
          progressAccumulator.ingest(update.delta);
          toolDraftProgressScheduler.schedule(update.contentIndex);
        } else if (update.type === "toolcall_end") {
          liveToolDraftNames.delete(update.contentIndex);
          toolDraftProgressScheduler.finish(update.contentIndex);
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
          this.deps.events.publishBestEffort(
            "conversation.live.tool_draft.done",
            data,
            "conversation.live.tool_draft.done",
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
          toolDraftProgressScheduler.clear();
        }
        assistantEntryMeta.onMessageEnded(event.message.role);
        if (!canonical) {
          throw new Error(
            "Canonical harness settlement authority is required.",
          );
        }
        const mirrored: ConversationEntry[] =
          await settleCanonicalHarnessMessage({
            authority: canonical,
            agent,
            message: event.message,
          });
        let shouldPublishContextUsage = false;
        markMirroredEntriesMaterialized(
          this.deps.state.conversationRuntime,
          runId,
          mirrored,
        );
        for (const entry of mirrored) {
          if (entry.role === "assistant") {
            lastAssistantEntry = entry;
            if (entry.usage) shouldPublishContextUsage = true;
          }
        }
        if (shouldPublishContextUsage && !canonical) {
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
    let forcePushGeneration = 0;
    const abort = async () => {
      abortRequested = true;
      toolDraftProgressScheduler.clear();
      runAbortController.abort();
      harness.requestAbort();
    };
    const updateAgentRuntimeConfig = async (updatedAgent: AgentRecord) => {
      const nextActiveToolNames = await this.activeToolNamesFor(
        updatedAgent,
        capabilitySelection.disabledTools,
      );
      if (!sameStringList(nextActiveToolNames, activeToolNames)) {
        activeToolNames = nextActiveToolNames;
        await harness.setActiveTools(nextActiveToolNames);
      }
      const nextModel = resolveAgentModel(
        updatedAgent.model,
        await this.customModels(updatedAgent.projectDir),
      );
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
    const expandBlocks = (text: string, images?: PromptRequest["images"]) =>
      canonical
        ? Promise.resolve({ text, images })
        : expandExecutablePromptBlocks(
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
      forcePush: async () => {
        forcePushGeneration += 1;
        toolDraftProgressScheduler.clear();
        await harness.forcePush();
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
    let continueAttempt = options.continue === true || Boolean(canonical);
    let handledForcePushGeneration = 0;
    while (true) {
      const runAssistant = await this.runHarnessAttempt({
        harness,
        conversation: harnessConversation,
        request: promptRequest,
        continue: continueAttempt,
        runId,
        agent,
        signal: runAbortController.signal,
        canonical: Boolean(canonical),
      });
      if (forcePushGeneration > handledForcePushGeneration) {
        handledForcePushGeneration = forcePushGeneration;
        continueAttempt = true;
        continue;
      }
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
        if (forcePushGeneration > handledForcePushGeneration) {
          handledForcePushGeneration = forcePushGeneration;
          continueAttempt = true;
          continue;
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
      await checkpointLegacyProviderResponse(coordinator);
      if (forcePushGeneration > handledForcePushGeneration) {
        handledForcePushGeneration = forcePushGeneration;
        continueAttempt = true;
        continue;
      }
      return {
        status: "completed",
        result: { finalEntryId: assistantEntry.id },
      };
    }
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
  }
}
