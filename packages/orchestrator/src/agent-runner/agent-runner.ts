import {
  AgentHarness,
  buildSessionContext,
  convertToLlm,
  estimateContextTokens,
  NodeExecutionEnv,
  resolveAgentModel,
  Session,
} from "@nerve/agent";
import {
  type AgentRecord,
  type CreateAgentRequest,
  createId,
  type ProjectRecord,
  type PromptRequest,
  type SessionEntry,
  type SessionRecord,
} from "@nerve/shared";
import {
  activeToolNamesForAgent,
  createAgentToolsForAgent,
  toolPromptMetadata,
} from "../agent-tool-adapter.js";
import type { AuthManager } from "../auth.js";
import type { ConversationService } from "../conversation-service.js";
import type { EventBus } from "../events.js";
import type { HarnessManager } from "../harness-manager.js";
import { HttpError } from "../http/errors.js";
import { buildPiSystemPrompt } from "../pi-system-prompt.js";
import { loadHarnessResources } from "../resource-loader.js";
import type { CompactionService } from "../session-operations/index.js";
import type { InitializedStorage } from "../storage.js";
import type { ToolService } from "../tool-service.js";
import type { AppendEntryFn, MessageMirror } from "./message-mirror.js";
import type { AgentRunStateMap } from "./run-state.js";
import { SubagentRunner } from "./subagent-runner.js";
import { nerveSystemContext } from "./system-prompt-builder.js";

export interface AgentRunnerDeps {
  storage: InitializedStorage;
  events: EventBus;
  auth: AuthManager;
  tools: ToolService;
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
  ): Promise<SessionEntry> {
    if (this.deps.runs.has(agent.id)) {
      throw new HttpError(409, "AGENT_BUSY", "Agent is already running.");
    }

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
    const runId = createId("run");
    let abortRequested = false;
    const activeToolNames = activeToolNamesForAgent(agent);
    const promptMetadata = toolPromptMetadata(activeToolNames);
    const model = resolveAgentModel(agent.model);
    const env = new NodeExecutionEnv({ cwd: agent.projectDir });
    const resources = await loadHarnessResources(agent.projectDir);
    let lastAssistantEntry: SessionEntry | undefined;

    const harness = new AgentHarness({
      env,
      session: harnessSession,
      resources: { skills: resources.skills },
      tools: createAgentToolsForAgent(agent, this.deps.tools),
      activeToolNames,
      model,
      getApiKeyAndHeaders: async (requestModel) => {
        if (requestModel.provider === "nerve-faux") return undefined;
        const apiKey = await this.deps.auth.getApiKey(requestModel.provider);
        return apiKey ? { apiKey } : undefined;
      },
      systemPrompt: () =>
        buildPiSystemPrompt({
          cwd: agent.projectDir,
          selectedTools: activeToolNames,
          toolSnippets: promptMetadata.snippets,
          promptGuidelines: promptMetadata.guidelines,
          contextFiles: resources.contextFiles,
          skills: resources.skills,
          customPrompt: resources.systemPrompt,
          appendSystemPrompt: resources.appendSystemPrompt,
          nerveContext: nerveSystemContext(agent),
        }),
    });

    harness.subscribe(async (event) => {
      if (event.type === "agent_start") {
        await this.deps.events.publish("agent.started", {
          agentId: agent.id,
          runId,
        });
        return;
      }
      if (event.type === "message_update") {
        const update = event.assistantMessageEvent;
        if (update.type === "text_delta") {
          await this.deps.events.publish("agent.message_delta", {
            agentId: agent.id,
            runId,
            sessionId: agent.sessionId,
            delta: update.delta,
          });
        }
        return;
      }
      if (event.type === "message_end") {
        const mirrored = await this.deps.messageMirror.mirrorNewHarnessEntries(
          agent,
          storage,
          initialHarnessEntryIds,
        );
        for (const entry of mirrored) {
          if (entry.role === "user") {
            await this.deps.events.publish("agent.prompt_received", {
              agentId: agent.id,
              entry,
            });
            await this.deps.messageMirror.maybeDeriveInitialSessionTitle(
              session.id,
              entry.text,
            );
          } else if (entry.role === "assistant") {
            lastAssistantEntry = entry;
          }
        }
        return;
      }
    });

    this.deps.runs.set(agent.id, {
      runId,
      abort: () => {
        abortRequested = true;
        void harness.abort();
      },
      messages: this.deps.conversationService.getForAgent(agent.id) ?? [],
      steer: (text, options) =>
        harness.steer(text, { images: options?.images }),
      followUp: (text, options) =>
        harness.followUp(text, { images: options?.images }),
    });
    await this.deps.setAgentStatus(agent, "running");

    try {
      await harness.prompt(request.text, { images: request.images });
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
      await this.deps.events.publish("agent.message_complete", {
        agentId: agent.id,
        runId,
        sessionId: agent.sessionId,
        entry: assistantEntry,
      });
      await this.maybeAutoCompact(agent.sessionId).catch((error) => {
        process.emitWarning(
          `Auto-compaction failed for ${agent.sessionId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
      return assistantEntry;
    } catch (error) {
      this.deps.runs.delete(agent.id);
      const aborted = abortRequested;
      const latest = this.deps.agents.get(agent.id);
      if (latest)
        await this.deps.setAgentStatus(latest, aborted ? "aborted" : "error");
      await this.deps.events.publish("agent.error", {
        agentId: agent.id,
        runId,
        message: error instanceof Error ? error.message : String(error),
        aborted,
      });
      throw error;
    }
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
    if (tokens < this.deps.storage.settings.compaction.thresholdTokens) return;
    await this.deps.compactionService.compactSession(sessionId, {
      instructions:
        "Automatic compaction after the configured token threshold was exceeded.",
      keepRecentTokens: this.deps.storage.settings.compaction.keepRecentTokens,
    });
  }
}
