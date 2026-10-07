import { startWorkbenchLiveTurn } from "./workbench-live-turn.js";
import {
  prepareWorkbenchTurn,
  dispatchWorkbenchTurn,
} from "./workbench-turn-preparation.js";
import { resolveCompactionOwner } from "../../conversations/compaction-owner.js";
import { userPromptControls } from "./user-prompt-control.js";
import { installIterationCompaction } from "./iteration-compaction.js";
import { createWorkbenchAgentHarness } from "./workbench-agent-harness.js";
import type { CoordinatorExecutionOptions } from "./coordinator-execution-options.js";
import { type AnyModel } from "@nervekit/harness/agent";
import { Conversation } from "@nervekit/harness/conversation";
import { convertToLlm } from "@nervekit/harness/messages";
import { resolveAgentModel } from "@nervekit/harness/models";
import { NodeExecutionEnv } from "@nervekit/harness/node";
import type { AgentRecord, PromptRequest } from "@nervekit/contracts/agents";
import type { ConversationEntry } from "@nervekit/contracts/conversations";
import { normalizeRunFailure } from "@nervekit/contracts/runs";
import { toolNameSchema } from "@nervekit/contracts/tools";
import { HostHarnessFactory } from "./harness-factory.js";
import type { RunExecutionOutcome } from "../../runs/runtime/index.js";
import { planDirForStorageHome } from "../../plans/plan-paths.js";
import { toPublicToolCallArgsPreview } from "../../tools/artifacts/tool-call-transcript-preview.js";
import type { WorkbenchLiveExecutionControl } from "../../runs/application/run-live-executions.js";
import { loadHarnessResources } from "../prompting/resource-loader.js";
import type { WorkbenchAgentMechanics } from "./workbench-agent-mechanics.js";
import {
  assistantContentRedacted,
  assistantToolCallDraft,
  errorTextFromToolResult,
  recordFromUnknown,
  isRetryableAssistantError,
} from "./harness-execution-shared.js";
import { expandExecutablePromptBlocks } from "./prompt-block-expansion.js";
import { handleWorkbenchHarnessError } from "./workbench-harness-outcome.js";
import {
  LiveToolDraftReconciler,
  type LiveToolDraftState,
} from "./live-tool-draft-reconciliation.js";
import {
  AssistantEntryMetaQueue,
  markMirroredEntriesMaterialized,
} from "./message-mirror.js";
import { composeAgentSystemPrompt } from "./system-prompt-builder.js";
import { createRunCapabilityResources } from "./run-capability-resources.js";
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
  const liveToolDraftReconciler = new LiveToolDraftReconciler({
    conversationRuntime: this.deps.state.conversationRuntime,
    publish: (type, data) =>
      this.deps.events.publishBestEffort(type, data, type),
    runId,
    getTurnId: () => currentTurnId,
    getLiveMessageId: () => currentLiveMessageId,
  });
  let clearDraftProgress = () => {};
  const abandonMessage = () => {
    clearDraftProgress();
    liveToolDraftReconciler.abandon();
    currentLiveMessageId = undefined;
    liveToolDrafts.clear();
  };
  let originatingTurn:
    | import("./workbench-turn-preparation.js").WorkbenchOriginatingTurn
    | undefined;
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
    const storage = await this.deps.harnessStorage.openAgentStorage(agent);
    const harnessConversation = new Conversation(storage);
    const initialHarnessEntryIds = new Set(
      (await storage.getEntries()).map((entry) => entry.id),
    );
    const latestAgent = () => this.deps.state.agents.get(agent.id) ?? agent;
    const capabilities = await createRunCapabilityResources({
      resolveSelection: () =>
        this.deps.capabilities.resolve(agent.projectId, agent.conversationId),
      loadResources: (selection) =>
        loadHarnessResources(agent.projectDir, {
          storageHome: this.deps.storage.paths.home,
          disabledSkillNames: selection.disabledFileSkills,
          enabledNerveSkillNames: selection.enabledNerveSkills,
          nerveSkills: this.deps.nerveSkills.skills,
          enabledAgentBrowserSkillNames: selection.enabledAgentBrowserSkills,
          agentBrowserSkills: this.deps.agentBrowserSkills.skills,
        }),
      resolveActiveToolNames: (current, selection) =>
        this.activeToolNamesFor(current, selection),
      latestAgent,
      onError: (error) =>
        void this.deps.logger.warn("Capability refresh failed", {
          agentId: agent.id,
          conversationId: agent.conversationId,
          projectId: agent.projectId,
          runId,
          context: { error: String(error) },
        }),
    });
    const model = resolveAgentModel(
      agent.model,
      await this.customModels(agent.projectDir),
    );
    this.deps.subscriptionUsage.touchProvider(model.provider);
    const shellPath = settings.runtime.shellPath;
    const env = new NodeExecutionEnv({ cwd: agent.projectDir, shellPath });
    const composeLatestSystemPrompt = async () => {
      await capabilities.refresh();
      return composeAgentSystemPrompt(
        latestAgent(),
        capabilities.activeToolNames(),
        capabilities.resources(),
        { planDir: planDirForStorageHome(this.deps.storage.paths.home) },
      );
    };
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
    clearDraftProgress = () => toolDraftProgressScheduler.clear();
    let currentProviderForResponse: string | undefined;
    let preparedTurnOrdinal = 0;
    let effectiveTurn:
      | import("@nervekit/contracts/agents").EffectiveTurnConfiguration
      | undefined;
    const harnessFactory = new HostHarnessFactory({
      resolveModel: async () => model,
      resolveCredentials: async () => (requestModel: AnyModel) =>
        this.deps.auth.requestAuthForPiModel(requestModel),
      resolvePolicy: async () => ({
        tools: [],
        activeToolNames: [],
      }),
      create: async ({ environment }) =>
        createWorkbenchAgentHarness({
          env,
          conversation: harnessConversation,
          resources: { skills: capabilities.resources().skills },
          tools: environment.policy.tools,
          activeToolNames: environment.policy.activeToolNames,
          model: environment.model,
          thinkingLevel: agent.thinkingLevel,
          maxParallelToolCalls: this.deps.maxParallelToolsPerRun,
          getApiKeyAndHeaders: environment.credentials,
          systemPrompt: composeLatestSystemPrompt,
          hasPendingTurnInput: async () =>
            (await this.deps.agentInputs?.hasEligible(agent.id, runId)) ??
            false,
          prepareTurn: async () => {
            const {
              effective,
              actor,
              permissionContext,
              toolAuthority,
              ...snapshot
            } = await prepareWorkbenchTurn({
              mechanics: this,
              conversation: harnessConversation,
              initialPromptHasImages:
                preparedTurnOrdinal === 0 && Boolean(request.images?.length),
              agent,
              coordinator,
              runAbortController,
              shellPath,
              turnId: `prepared_${coordinator.run.executionId}_${++preparedTurnOrdinal}`,
            });
            currentTurnId = undefined;
            originatingTurn = { actor, permissionContext, toolAuthority };
            effectiveTurn = effective;
            return snapshot;
          },
        }),
    });
    const harness = await harnessFactory.create({
      scope: { conversationId: conversation.id, agentId: agent.id, runId },
      context: undefined,
    });
    capabilities.attach(harness);
    installIterationCompaction(
      harness,
      (signal) =>
        this.maybeAutoCompactAtIteration(
          agent.conversationId,
          agent.id,
          runId,
          harnessConversation,
          signal,
        ),
      () =>
        this.takeAutoCompactionContinuation(
          runId,
          resolveCompactionOwner(agent.conversationId, agent).ownerAgentId !==
            undefined,
        ),
    );
    // Provider lifecycle callbacks are awaited hooks, not observational subscriptions.
    harness.on("before_provider_request", async (event) => {
      if (!effectiveTurn)
        throw new Error(
          "Effective configuration is unavailable before provider dispatch",
        );
      currentTurnId ??= startWorkbenchLiveTurn(this, agent, runId);
      await dispatchWorkbenchTurn(
        this,
        effectiveTurn,
        currentTurnId,
        coordinator,
        runAbortController.signal,
      );
      currentProviderForResponse = event.model.provider;
      this.deps.subscriptionUsage.touchProvider(event.model.provider);
      return undefined;
    });
    harness.on("after_provider_response", async (event) => {
      const responseProvider = currentProviderForResponse;
      currentProviderForResponse = undefined;
      if (responseProvider === "openai-codex")
        this.deps.subscriptionUsage.applyCodexHeaders(event.headers);
      return undefined;
    });
    harness.subscribe(async (event) => {
      if (event.type === "queue_drained") {
        for (const promptId of event.messageIds) {
          await coordinator.sink.promptDelivered(promptId);
        }
        return;
      }
      if (event.type === "turn_start") {
        coordinator.installControl(liveControl);
        currentTurnId = startWorkbenchLiveTurn(this, agent, runId);
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
          parsedToolName.data,
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
        abandonMessage();
        const turnId =
          currentTurnId ??
          (currentTurnId = startWorkbenchLiveTurn(this, agent, runId));
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
          if (
            entry.role === "user" &&
            resolveCompactionOwner(agent.conversationId, agent).ownerAgentId ===
              undefined
          ) {
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
    const expandBlocks = (text: string, images?: PromptRequest["images"]) =>
      expandExecutablePromptBlocks(
        (command, opts) =>
          this.executeInlinePromptBlockCommand(agent, command, opts),
        { text, images },
        runAbortController.signal,
      );
    const liveControl: WorkbenchLiveExecutionControl = {
      ...userPromptControls(
        harness,
        harnessConversation,
        this.deps.harnessStorage,
        expandBlocks,
      ),
      forcePush: async () => {
        forcePushGeneration += 1;
        toolDraftProgressScheduler.clear();
        await harness.forcePush();
      },
      continue: async () => undefined,
      cancel: abort,
      // Edits are persisted elsewhere and adopted only at prepareTurn.
      updateAgentRuntimeConfig: async () => undefined,
    };
    const promptRequest = await expandBlocks(request.text, request.images);
    let continueAttempt = options.continue === true;
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
      });
      const messages = convertToLlm((await storage.buildContext()).messages);
      this.deps.conversationService.setForAgent(agent.id, messages);
      if (forcePushGeneration > handledForcePushGeneration) {
        handledForcePushGeneration = forcePushGeneration;
        continueAttempt = true;
        continue;
      }
      if (
        !runAbortController.signal.aborted &&
        (await this.deps.agentInputs?.hasEligible(agent.id, runId))
      ) {
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
                  ...normalizeRunFailure(
                    runAssistant.errorMessage ?? "Agent run failed.",
                    "provider",
                  ),
                  retryable,
                  continuable,
                },
              }),
        } as RunExecutionOutcome;
      }
      await coordinator.sink.checkpoint(
        await coordinator.checkpointCommand("after_provider_response"),
      );
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
    return handleWorkbenchHarnessError({
      mechanics: this,
      agent,
      coordinator,
      error,
      originatingTurn,
      abortRequested,
      runAbortController,
    });
  } finally {
    abandonMessage();
    this.finishAutoCompactionRun?.(runId);
  }
}
