import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  AgentHarness,
  AgentToolSuspension,
  buildSessionContext,
  computeContextUsage,
  convertToLlm,
  estimateContextTokens,
  getModelContextWindow,
  isAgentToolSuspension,
  NodeExecutionEnv,
  resolveAgentModel,
  Session,
  shouldCompact,
} from "@nerve/agent";
import {
  type AgentRecord,
  type ContextUsage,
  type CreateAgentRequest,
  createId,
  type ProjectRecord,
  type PromptRequest,
  type SessionEntry,
  type SessionRecord,
} from "@nerve/shared";
import type { AgentSuspensionService } from "../agent-suspension-service.js";
import {
  activeToolNamesForAgent,
  createAgentToolsForAgent,
  toolPromptMetadata,
} from "../agent-tool-adapter.js";
import type { AuthManager } from "../auth.js";
import type { ConversationRuntime } from "../conversation-runtime.js";
import type { ConversationService } from "../conversation-service.js";
import type { EventBus } from "../events.js";
import type { HarnessManager } from "../harness-manager.js";
import { HttpError } from "../http/errors.js";
import { planDirForStorageHome } from "../plan-paths.js";
import { loadHarnessResources } from "../resource-loader.js";
import type { CompactionService } from "../session-operations/index.js";
import type { InitializedStorage } from "../storage.js";
import type { ToolService } from "../tool-service.js";
import type { SubscriptionUsageService } from "../usage/subscription-usage-service.js";
import type { AppendEntryFn, MessageMirror } from "./message-mirror.js";
import type { AgentRunStateMap } from "./run-state.js";
import { SubagentRunner } from "./subagent-runner.js";
import { composeAgentSystemPrompt } from "./system-prompt-builder.js";
import { shouldStreamToolDraftArguments } from "./tool-draft-streaming.js";

export interface AgentRunnerDeps {
  storage: InitializedStorage;
  events: EventBus;
  auth: AuthManager;
  tools: ToolService;
  suspensions: AgentSuspensionService;
  harnessManager: HarnessManager;
  conversationService: ConversationService;
  compactionService: CompactionService;
  runs: AgentRunStateMap;
  agents: Map<string, AgentRecord>;
  getSession: (sessionId: string) => SessionRecord;
  getProject: (projectId: string) => ProjectRecord;
  createAgent: (
    request: CreateAgentRequest,
    options?: { allowChildAuthorityExceed?: boolean },
  ) => Promise<AgentRecord>;
  setAgentStatus: (
    agent: AgentRecord,
    status: AgentRecord["status"],
  ) => Promise<void>;
  appendEntry: AppendEntryFn;
  updateSession: (session: SessionRecord) => Promise<void>;
  messageMirror: MessageMirror;
  conversationRuntime: ConversationRuntime;
  subscriptionUsage: SubscriptionUsageService;
}

export class AgentRunner {
  private readonly subagents: SubagentRunner;

  constructor(private readonly deps: AgentRunnerDeps) {
    this.subagents = new SubagentRunner({
      storage: deps.storage,
      events: deps.events,
      harnessManager: deps.harnessManager,
      createAgent: deps.createAgent,
      runAgentPrompt: (agent, request) => this.runAgentPrompt(agent, request),
      appendEntry: deps.appendEntry,
      getSession: deps.getSession,
      updateSession: deps.updateSession,
    });
  }

  async promptAgent(agentId: string, request: PromptRequest): Promise<void> {
    const agent = this.deps.agents.get(agentId);
    if (!agent) throw new HttpError(404, "AGENT_NOT_FOUND", "Agent not found.");
    if (agent.status === "awaiting_user") {
      throw new HttpError(
        409,
        "AGENT_AWAITING_USER",
        "Agent is awaiting a human-in-the-loop tool response.",
      );
    }
    const activeRun = this.deps.runs.get(agent.id);
    if (activeRun) {
      if (request.behavior === "steer" && activeRun.steer) {
        await activeRun.steer(request.text, request);
        return;
      }
      if (request.behavior === "follow-up" && activeRun.followUp) {
        await activeRun.followUp(request.text, request);
        return;
      }
      throw new HttpError(409, "AGENT_BUSY", "Agent is already running.");
    }
    void this.runAgentPrompt(agent, request).catch(() => undefined);
  }

  async continueAgent(agentId: string): Promise<void> {
    const agent = this.deps.agents.get(agentId);
    if (!agent) throw new HttpError(404, "AGENT_NOT_FOUND", "Agent not found.");
    if (this.deps.runs.has(agent.id)) {
      throw new HttpError(409, "AGENT_BUSY", "Agent is already running.");
    }
    void this.runAgentPrompt(
      agent,
      { text: "Continue after resolved tool result." },
      { continue: true },
    ).catch(() => undefined);
  }

  async abortAgent(agentId: string): Promise<void> {
    const agent = this.deps.agents.get(agentId);
    if (!agent) throw new HttpError(404, "AGENT_NOT_FOUND", "Agent not found.");
    for (const child of this.deps.agents.values()) {
      if (child.parentAgentId === agent.id) await this.abortAgent(child.id);
    }
    const run = this.deps.runs.get(agentId);
    if (!run) return;
    run.abort();
    await this.deps.events.publish("agent.abort_requested", {
      agentId,
      runId: run.runId,
    });
  }

  runSubagent(
    parent: AgentRecord,
    args: Record<string, unknown>,
  ): Promise<{ agent: AgentRecord; summary: string }> {
    return this.subagents.runSubagent(parent, args);
  }

  async runAgentPrompt(
    agent: AgentRecord,
    request: PromptRequest,
    options: { continue?: boolean } = {},
  ): Promise<SessionEntry> {
    if (this.deps.runs.has(agent.id)) {
      throw new HttpError(409, "AGENT_BUSY", "Agent is already running.");
    }

    const runId = createId("run");
    let abortRequested = false;
    let lastAssistantEntry: SessionEntry | undefined;
    let currentTurnId: string | undefined;
    let currentLiveMessageId: string | undefined;
    const liveToolDraftNames = new Map<number, string | undefined>();

    try {
      const session = this.deps.getSession(agent.sessionId);
      const project = this.deps.getProject(agent.projectId);
      const storage = await this.deps.harnessManager.openStorage(
        session,
        project.dir,
      );
      const harnessSession = new Session(storage);
      const initialHarnessEntryIds = new Set(
        (await storage.getEntries()).map((entry) => entry.id),
      );
      const activeToolNames = activeToolNamesForAgent(agent);
      const model = resolveAgentModel(agent.model);
      this.deps.subscriptionUsage.touchProvider(model.provider);
      const env = new NodeExecutionEnv({ cwd: agent.projectDir });
      const resources = await loadHarnessResources(agent.projectDir);
      const latestAgent = () => this.deps.agents.get(agent.id) ?? agent;
      const composeLatestSystemPrompt = () => {
        const currentAgent = latestAgent();
        const currentActiveToolNames = activeToolNamesForAgent(currentAgent);
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
        session: harnessSession,
        resources: { skills: resources.skills },
        tools: createAgentToolsForAgent(agent, this.deps.tools, {
          runId,
          resolveToolAnchor: (providerToolCallId) =>
            this.deps.conversationRuntime.resolveToolAnchor(
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
          const turn = this.deps.conversationRuntime.startTurn(runId);
          currentTurnId = turn.turnId;
          currentLiveMessageId = undefined;
          return;
        }
        if (
          event.type === "message_start" &&
          event.message.role === "assistant"
        ) {
          if (!currentTurnId) {
            const turn = this.deps.conversationRuntime.startTurn(runId);
            currentTurnId = turn.turnId;
          }
          const started = this.deps.conversationRuntime.startAssistantMessage(
            runId,
            currentTurnId,
          );
          currentLiveMessageId = started.liveMessageId;
          liveToolDraftNames.clear();
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
            const data = this.deps.conversationRuntime.applyContentDelta({
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
            const data = this.deps.conversationRuntime.applyContentDelta({
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
            const data = this.deps.conversationRuntime.finishContent({
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
            const data = this.deps.conversationRuntime.finishContent({
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
            const data = this.deps.conversationRuntime.startToolDraft({
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
            if (!shouldStreamToolDraftArguments(toolName)) return;
            const data = this.deps.conversationRuntime.applyToolDraftDelta({
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
          } else if (update.type === "toolcall_end") {
            liveToolDraftNames.delete(update.contentIndex);
            const data = this.deps.conversationRuntime.finishToolDraft({
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
              sessionId: agent.sessionId,
              agentId: agent.id,
              runId,
              turnId: entry.turnId ?? currentTurnId,
              liveMessageId: entry.liveMessageId,
              entry,
            });
            if (entry.role === "user") {
              await this.deps.messageMirror.maybeDeriveInitialSessionTitle(
                session.id,
                entry.text,
              );
            } else if (entry.role === "assistant") {
              lastAssistantEntry = entry;
              if (entry.usage) shouldPublishContextUsage = true;
            }
          }
          if (shouldPublishContextUsage) {
            await this.publishContextUsage(
              agent.sessionId,
              agent.id,
              runId,
            ).catch((error) => {
              process.emitWarning(
                `Context-usage publish failed for ${agent.sessionId}: ${
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
      this.deps.conversationRuntime.startRun({
        agentId: agent.id,
        projectId: agent.projectId,
        sessionId: agent.sessionId,
        runId,
        startedAt,
      });
      await this.deps.events.publish("conversation.run.started", {
        agentId: agent.id,
        projectId: agent.projectId,
        sessionId: agent.sessionId,
        runId,
        parentEntryId: session.activeEntryId,
        startedAt,
      });

      this.deps.runs.set(agent.id, {
        runId,
        abort: () => {
          abortRequested = true;
          this.deps.conversationRuntime.markAborting(runId);
          void harness.abort();
        },
        messages: this.deps.conversationService.getForAgent(agent.id) ?? [],
        steer: (text, options) =>
          harness.steer(text, { images: options?.images }),
        followUp: (text, options) =>
          harness.followUp(text, { images: options?.images }),
        updateAgentRuntimeConfig: async (updatedAgent) => {
          await harness.setActiveTools(activeToolNamesForAgent(updatedAgent));
        },
      });
      await this.deps.setAgentStatus(agent, "running");

      if (options.continue) {
        await harness.continue();
      } else {
        await harness.prompt(request.text, { images: request.images });
      }
      const latest = this.deps.agents.get(agent.id);
      if (latest) await this.deps.setAgentStatus(latest, "idle");
      this.deps.runs.delete(agent.id);
      const branch = await storage.getPathToRoot(await storage.getLeafId());
      const messages = convertToLlm(buildSessionContext(branch).messages);
      this.deps.conversationService.setForAgent(agent.id, messages);
      const assistantEntry = lastAssistantEntry;
      if (!assistantEntry) {
        throw new Error("Agent run completed without an assistant entry.");
      }
      const completedAt = new Date().toISOString();
      await this.deps.events.publish("conversation.run.completed", {
        agentId: agent.id,
        projectId: agent.projectId,
        runId,
        sessionId: agent.sessionId,
        finalEntryId: assistantEntry.id,
        completedAt,
      });
      this.deps.conversationRuntime.completeRun(runId);
      await this.maybeAutoCompact(agent.sessionId).catch((error) => {
        process.emitWarning(
          `Auto-compaction failed for ${agent.sessionId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
      await this.publishContextUsage(agent.sessionId, agent.id, runId).catch(
        (error) => {
          process.emitWarning(
            `Context-usage publish failed for ${agent.sessionId}: ${
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
        this.deps.runs.delete(agent.id);
        const latest = this.deps.agents.get(agent.id);
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
          sessionId: agent.sessionId,
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
        await this.deps.events.publish("conversation.run.suspended", {
          agentId: agent.id,
          projectId: agent.projectId,
          runId,
          sessionId: agent.sessionId,
          suspensionId: suspension.id,
          toolCallId: toolCall.id,
          suspendedAt,
          reason: suspensionError.data.reason,
        });
        this.deps.conversationRuntime.completeRun(runId);
        if (lastAssistantEntry) return lastAssistantEntry;
        throw new Error("Agent run suspended without an assistant entry.");
      }
      this.deps.runs.delete(agent.id);
      const aborted = abortRequested;
      const latest = this.deps.agents.get(agent.id);
      if (latest)
        await this.deps.setAgentStatus(latest, aborted ? "aborted" : "error");
      await this.deps.events.publish("conversation.run.failed", {
        agentId: agent.id,
        projectId: agent.projectId,
        runId,
        sessionId: agent.sessionId,
        message: error instanceof Error ? error.message : String(error),
        aborted,
        failedAt: new Date().toISOString(),
      });
      this.deps.conversationRuntime.failRun(runId);
      throw error;
    }
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

  /** Compute compaction-aware context-window usage for a session. */
  async getContextUsage(sessionId: string): Promise<ContextUsage> {
    const session = this.deps.getSession(sessionId);
    const project = this.deps.getProject(session.projectId);
    const storage = await this.deps.harnessManager.openStorage(
      session,
      project.dir,
    );
    const branch = await storage.getPathToRoot(await storage.getLeafId());
    const messages = buildSessionContext(branch).messages;
    const agent = session.activeAgentId
      ? this.deps.agents.get(session.activeAgentId)
      : undefined;
    const contextWindow = getModelContextWindow(agent?.model);
    return computeContextUsage(messages, branch, contextWindow);
  }

  private async publishContextUsage(
    sessionId: string,
    agentId: string,
    runId: string,
  ): Promise<void> {
    const contextUsage = await this.getContextUsage(sessionId);
    await this.deps.events.publish(
      "conversation.context.updated",
      { sessionId, agentId, runId, contextUsage },
      { durability: "transient" },
    );
  }

  private async maybeAutoCompact(sessionId: string): Promise<void> {
    if (!this.deps.storage.settings.compaction.auto) return;
    const session = this.deps.getSession(sessionId);
    const project = this.deps.getProject(session.projectId);
    const storage = await this.deps.harnessManager.openStorage(
      session,
      project.dir,
    );
    const branch = await storage.getPathToRoot(await storage.getLeafId());
    const tokens = estimateContextTokens(
      buildSessionContext(branch).messages,
    ).tokens;
    const agent = session.activeAgentId
      ? this.deps.agents.get(session.activeAgentId)
      : undefined;
    const contextWindow = getModelContextWindow(agent?.model);
    if (contextWindow <= 0) return;
    const settings = {
      enabled: this.deps.storage.settings.compaction.auto,
      reserveTokens: this.deps.storage.settings.compaction.reserveTokens,
      keepRecentTokens: this.deps.storage.settings.compaction.keepRecentTokens,
    };
    if (!shouldCompact(tokens, contextWindow, settings)) return;
    await this.deps.compactionService.compactSession(sessionId, {
      instructions:
        "Automatic compaction after the selected model's context threshold was exceeded.",
      keepRecentTokens: settings.keepRecentTokens,
    });
  }
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
