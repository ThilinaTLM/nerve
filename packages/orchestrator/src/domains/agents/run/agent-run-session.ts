/* eslint-disable max-lines -- AgentRunSession coordinates the complete agent run lifecycle and suspension flow. */
import {
  AgentHarness,
  buildConversationContext,
  Conversation,
  convertToLlm,
  isAgentToolSuspension,
  NodeExecutionEnv,
  resolveAgentModel,
} from "@nervekit/agent-runtime";
import type {
  AgentRecord,
  ConversationEntry,
  PromptRequest,
  ToolName,
} from "@nervekit/contracts";
import {
  createId,
  findExecutableCommandBlocks,
  replaceExecutableCommandBlocks,
  toolNameSchema,
} from "@nervekit/contracts";
import { HttpError } from "../../../http/errors.js";
import { planDirForStorageHome } from "../../plans/plan-paths.js";
import {
  activeToolNamesForAgent,
  createAgentToolsForAgent,
  toolPromptMetadata,
} from "../../tools/agent-tool-adapter.js";
import { loadHarnessResources } from "../prompting/resource-loader.js";
import type { AgentRunner } from "./agent-runner.js";
import {
  assistantContentRedacted,
  assistantToolCallDraft,
  errorTextFromToolResult,
  recordFromUnknown,
  sameStringList,
} from "./agent-runner-shared.js";
import { inlineCommandExecutionResultText } from "./inline-command-results.js";
import {
  LiveToolDraftReconciler,
  type LiveToolDraftState,
} from "./live-tool-draft-reconciliation.js";
import { composeAgentSystemPrompt } from "./system-prompt-builder.js";
import {
  createToolDraftProgressAccumulator,
  type ToolDraftProgressAccumulator,
} from "./tool-draft-progress.js";
import {
  shouldPublishToolDraftProgress,
  shouldStreamToolDraftArguments,
} from "./tool-draft-streaming.js";
export async function runAgentPromptSession(
  this: AgentRunner,
  agent: AgentRecord,
  request: PromptRequest,
  options: { continue?: boolean } = {},
): Promise<ConversationEntry> {
  if (this.deps.state.runs.has(agent.id)) {
    throw new HttpError(409, "AGENT_BUSY", "Agent is already running.");
  }
  // A fresh (non-continuation) prompt resets the auto-continuation budget so
  // the runaway guard only counts back-to-back automatic continuations.
  if (!options.continue) {
    this.autoContinuationCounts.delete(agent.conversationId);
  }
  const runId = createId("run");
  const runStartedAt = performance.now();
  let abortRequested = false;
  const runAbortController = new AbortController();
  let lastAssistantEntry: ConversationEntry | undefined;
  let currentTurnId: string | undefined;
  let currentLiveMessageId: string | undefined;
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
    const storage = await this.deps.harnessManager.openStorage(
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
    const resources = await loadHarnessResources(agent.projectDir);
    const latestAgent = () => this.deps.state.agents.get(agent.id) ?? agent;
    const composeLatestSystemPrompt = () => {
      const currentAgent = latestAgent();
      const currentActiveToolNames = activeToolNamesForAgent(currentAgent, {
        pythonAvailable: activeToolNames.includes("python"),
        disabledToolNames: this.deps.storage.settings.tools.disabled,
        jiraEnabled: this.deps.storage.settings.tools.jira.enabled,
        confluenceEnabled: this.deps.storage.settings.tools.confluence.enabled,
      });
      return composeAgentSystemPrompt(
        currentAgent,
        currentActiveToolNames,
        toolPromptMetadata(currentActiveToolNames),
        resources,
        { planDir: planDirForStorageHome(this.deps.storage.paths.home) },
      );
    };
    const liveToolDraftReconciler = new LiveToolDraftReconciler({
      conversationRuntime: this.deps.state.conversationRuntime,
      publish: async (type, data) => {
        await this.deps.events.publish(type, data, { durability: "transient" });
      },
      runId,
      getTurnId: () => currentTurnId,
      getLiveMessageId: () => currentLiveMessageId,
    });
    let currentProviderForResponse: string | undefined;
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
        const turn = this.deps.state.conversationRuntime.startTurn(runId);
        currentTurnId = turn.turnId;
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
        liveToolDrafts.clear();
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
        if (event.message.role === "assistant" && liveToolDrafts.size > 0) {
          await liveToolDraftReconciler.reconcile(event.message, [
            ...liveToolDrafts.values(),
          ]);
          liveToolDrafts.clear();
          liveToolDraftNames.clear();
          liveToolDraftProgress.clear();
        }
        const liveMessageId =
          event.message.role === "assistant" ? currentLiveMessageId : undefined;
        const mirrored = await this.deps.messageMirror.mirrorNewHarnessEntries(
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
        runAbortController.abort();
        await harness.abort();
      },
      messages: this.deps.conversationService.getForAgent(agent.id) ?? [],
      steer: (text, options, queuedPromptId) =>
        harness.steer(text, { images: options?.images, id: queuedPromptId }),
      followUp: (text, options, queuedPromptId) =>
        harness.steer(text, { images: options?.images, id: queuedPromptId }),
      removeQueuedPrompt: harness.removeQueuedMessage.bind(harness),
      updateAgentRuntimeConfig: async (updatedAgent) => {
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

    const promptRequest = await expandExecutablePromptBlocks(
      this,
      agent,
      request,
      runAbortController.signal,
    );
    const runAssistant = await this.runHarnessWithRetries({
      harness,
      conversation: harnessConversation,
      request: promptRequest,
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
        ? await this.appendRunFailureStatus(
            agent,
            runId,
            assistantEntry,
            runAssistant,
          )
        : undefined;
      this.deps.state.conversationRuntime.failRun(runId);
      await this.terminateRunToolCalls(runId);
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
    await this.publishContextUsage(agent.conversationId, agent.id, runId).catch(
      (error) => {
        process.emitWarning(
          `Context-usage publish failed for ${agent.conversationId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      },
    );
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
        remainingToolCalls: (suspensionError.data.remainingToolCalls ?? []).map(
          (remaining) => ({
            id: remaining.id,
            name: remaining.name,
            arguments: remaining.arguments,
          }),
        ),
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
      throw new Error("Agent run suspended without an assistant entry.", {
        cause: error,
      });
    }
    this.deps.state.runs.delete(agent.id);
    const aborted = abortRequested;
    const latest = this.deps.state.agents.get(agent.id);
    if (latest)
      await this.deps.setAgentStatus(latest, aborted ? "aborted" : "error");
    const failureMessage =
      error instanceof Error ? error.message : String(error);
    const errorStatus =
      !aborted &&
      (await this.appendRunErrorStatus(
        agent,
        runId,
        failureMessage,
        lastAssistantEntry,
      ).catch(() => undefined));
    this.deps.state.conversationRuntime.failRun(runId);
    await this.terminateRunToolCalls(runId);
    await this.deps.events.publish("conversation.run.failed", {
      agentId: agent.id,
      projectId: agent.projectId,
      runId,
      conversationId: agent.conversationId,
      message: failureMessage,
      aborted,
      failedAt: new Date().toISOString(),
      retryExhausted: errorStatus || undefined,
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
async function expandExecutablePromptBlocks(
  runner: AgentRunner,
  agent: AgentRecord,
  request: PromptRequest,
  signal: AbortSignal,
): Promise<PromptRequest> {
  const blocks = findExecutableCommandBlocks(request.text);
  if (blocks.length === 0) return request;
  const replacements = [];
  for (const block of blocks) {
    if (signal.aborted) throw new Error("Command execution aborted.");
    const result = await runner.executeInlinePromptBlockCommand(
      agent,
      block.command,
      { signal },
    );
    replacements.push({
      block,
      text: inlineCommandExecutionResultText(block.command, result),
    });
  }
  return {
    ...request,
    text: replaceExecutableCommandBlocks(request.text, replacements),
  };
}
