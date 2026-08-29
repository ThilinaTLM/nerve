import { resolve } from "node:path";
import { clampAgentThinkingLevel } from "@nervekit/harness";
import {
  type AgentRecord,
  type CreateAgentRequest,
  createId,
  type Mode,
  type UpdateAgentRequest,
} from "@nervekit/contracts";
import { ApplicationError } from "../../core/application-error.js";
import type { StreamLogRegistry } from "../../infrastructure/events/index.js";
import type { RuntimeQueryCache } from "../../infrastructure/persistence/query-cache/index.js";
import type { InitializedStorage } from "../../infrastructure/storage-bootstrap/index.js";
import { resolveProjectSettings } from "../../infrastructure/configuration/index.js";
import type { RuntimeState } from "../../app/runtime/runtime-projections.js";
import type { AgentStatus } from "../../app/runtime/types.js";
import type { ConversationService } from "../conversations/conversation-service.js";
import type { AgentRepository } from "./agent.repository.js";
import { assertChildAuthority } from "./agent-authority.js";
import { agentBudget } from "./agent-budget.js";
import { setAgentStatus as setAgentStatusHelper } from "./agent-status.js";

function isModeOnlyUpdate(
  request: UpdateAgentRequest,
): request is UpdateAgentRequest & { mode: Mode } {
  return (
    request.mode !== undefined &&
    request.permissionLevel === undefined &&
    request.permissionRuleSetId === undefined &&
    request.model === undefined &&
    request.thinkingLevel === undefined
  );
}

function isRuntimeConfigUpdate(request: UpdateAgentRequest): boolean {
  return (
    request.mode === undefined &&
    (request.permissionLevel !== undefined ||
      request.permissionRuleSetId !== undefined ||
      request.model !== undefined ||
      request.thinkingLevel !== undefined)
  );
}

export class AgentLifecycleService {
  constructor(
    private readonly storage: InitializedStorage,
    private readonly events: StreamLogRegistry,
    private readonly queryCache: RuntimeQueryCache,
    private readonly state: RuntimeState,
    private readonly agentRepository: AgentRepository,
    private readonly conversationService: ConversationService,
    private readonly updateConversation: (
      conversation: ReturnType<RuntimeState["getConversation"]>,
    ) => Promise<void>,
    private readonly abortAgent: (agentId: string) => Promise<void>,
    private readonly activeRunId: (
      agent: AgentRecord,
    ) => Promise<string | undefined>,
    private readonly updateLiveAgent: (
      runId: string,
      agent: AgentRecord,
    ) => Promise<void>,
  ) {}

  async createAgent(
    request: CreateAgentRequest,
    options: { allowChildAuthorityExceed?: boolean } = {},
  ): Promise<AgentRecord> {
    const conversation = this.state.getConversation(request.conversationId);
    const project = this.state.getProject(request.projectId);
    const parent = request.parentAgentId
      ? this.state.agents.get(request.parentAgentId)
      : undefined;
    if (request.parentAgentId && !parent)
      throw new ApplicationError(
        404,
        "PARENT_AGENT_NOT_FOUND",
        "Parent agent not found.",
      );

    const now = new Date().toISOString();
    const id = createId("agent");
    const projectDir = resolve(request.projectDir ?? project.dir);
    const effectiveSettings = await resolveProjectSettings(
      this.storage,
      projectDir,
    );
    const defaultSelection = effectiveSettings.rememberLastAgentSelection
      ? effectiveSettings.lastAgentSelection
      : {
          mode: effectiveSettings.defaultMode,
          permissionLevel: effectiveSettings.defaultPermissionLevel,
          permissionRuleSetId:
            effectiveSettings.defaultPermissionRuleSetId ??
            effectiveSettings.defaultPermissionLevel,
          model: effectiveSettings.defaultModel,
          thinkingLevel: effectiveSettings.defaultThinkingLevel,
        };
    const mode = request.mode ?? (parent ? parent.mode : conversation.mode);
    const permissionLevel =
      request.permissionLevel ??
      (parent ? parent.permissionLevel : conversation.permissionLevel);
    const model = parent
      ? request.model
      : (request.model ?? defaultSelection.model);
    const thinkingLevel = parent
      ? request.thinkingLevel
      : (request.thinkingLevel ?? defaultSelection.thinkingLevel);
    if (parent) {
      assertChildAuthority(
        parent,
        mode,
        permissionLevel,
        Boolean(options.allowChildAuthorityExceed),
      );
    }
    const agent: AgentRecord = {
      id,
      conversationId: conversation.id,
      projectId: project.id,
      projectDir,
      parentAgentId: request.parentAgentId,
      rootAgentId: parent?.rootAgentId ?? id,
      mode,
      permissionLevel,
      permissionRuleSetId:
        request.permissionRuleSetId ??
        (parent
          ? "read_only"
          : (defaultSelection.permissionRuleSetId ?? permissionLevel)),
      workspaceScope: request.workspaceScope ?? { roots: [projectDir] },
      systemPrompt: request.systemPrompt,
      task: request.task,
      budget: agentBudget(parent, request.budget),
      model,
      thinkingLevel: clampAgentThinkingLevel(model, thinkingLevel),
      status: "idle",
      createdAt: now,
      updatedAt: now,
    };
    this.state.agents.set(agent.id, agent);
    this.queryCache.upsertAgent(agent);
    await this.writeAgent(agent);
    if (!parent) {
      await this.updateConversation({
        ...conversation,
        activeAgentId: agent.id,
        updatedAt: now,
      });
    }
    await this.events.publish("agent.created", { agent, task: request.task });
    return agent;
  }

  listAgents(): AgentRecord[] {
    return this.state.listAgents();
  }

  getAgent(agentId: string): AgentRecord {
    return this.state.getAgent(agentId);
  }

  async removeAgentInternal(agentId: string): Promise<void> {
    if (!this.state.agents.has(agentId)) return;
    const agent = this.state.agents.get(agentId);
    if (agent && (await this.activeRunId(agent)))
      await this.abortAgent(agentId);
    for (const child of [...this.state.agents.values()].filter(
      (candidate) => candidate.parentAgentId === agentId,
    )) {
      await this.removeAgentInternal(child.id);
    }
    this.state.agents.delete(agentId);
    this.conversationService.deleteAgent(agentId);
    this.queryCache.removeAgent(agentId);
    await this.agentRepository.remove(agentId);
  }

  async configureAgent(
    agentId: string,
    request: UpdateAgentRequest,
  ): Promise<AgentRecord> {
    const agent = this.getAgent(agentId);
    if (agent.parentAgentId) {
      throw new ApplicationError(
        409,
        "SUBAGENT_NOT_INTERACTIVE",
        "Sub-agents are managed by their parent run and cannot be configured directly.",
      );
    }
    const activeRunId = await this.activeRunId(agent);
    if (activeRunId) {
      if (isModeOnlyUpdate(request)) {
        return this.setAgentModeInternal(
          agent.id,
          request.mode,
          "Mode changed by user.",
        );
      }

      if (isRuntimeConfigUpdate(request)) {
        const model =
          request.model === null ? undefined : (request.model ?? agent.model);
        const updated: AgentRecord = {
          ...agent,
          permissionLevel: request.permissionLevel ?? agent.permissionLevel,
          permissionRuleSetId:
            request.permissionRuleSetId ??
            request.permissionLevel ??
            agent.permissionRuleSetId,
          model,
          thinkingLevel: clampAgentThinkingLevel(
            model,
            request.thinkingLevel ?? agent.thinkingLevel,
          ),
          updatedAt: new Date().toISOString(),
        };
        await this.updateAgent(updated);
        await this.updateLiveAgent(activeRunId, updated);
        await this.events.publish("agent.configured", { agent: updated });
        return updated;
      }

      throw new ApplicationError(
        409,
        "AGENT_BUSY",
        "Cannot update a running agent.",
      );
    }
    const model =
      request.model === null ? undefined : (request.model ?? agent.model);
    const updated: AgentRecord = {
      ...agent,
      mode: request.mode ?? agent.mode,
      permissionLevel: request.permissionLevel ?? agent.permissionLevel,
      permissionRuleSetId:
        request.permissionRuleSetId ??
        request.permissionLevel ??
        agent.permissionRuleSetId,
      model,
      thinkingLevel: clampAgentThinkingLevel(
        model,
        request.thinkingLevel ?? agent.thinkingLevel,
      ),
      updatedAt: new Date().toISOString(),
    };
    await this.updateAgent(updated);
    await this.events.publish("agent.configured", { agent: updated });
    return updated;
  }

  async setAgentModeInternal(
    agentId: string,
    mode: Mode,
    reason: string,
  ): Promise<AgentRecord> {
    const agent = this.getAgent(agentId);
    const updated: AgentRecord = {
      ...agent,
      mode,
      updatedAt: new Date().toISOString(),
    };
    await this.updateAgent(updated);
    const activeRunId = await this.activeRunId(agent);
    if (activeRunId) await this.updateLiveAgent(activeRunId, updated);
    await this.events.publish("agent.mode_changed", {
      agent: updated,
      previousMode: agent.mode,
      mode,
      reason,
    });
    return updated;
  }

  async setAgentStatus(agent: AgentRecord, status: AgentStatus): Promise<void> {
    await setAgentStatusHelper(
      agent,
      status,
      (updated) => this.updateAgent(updated),
      this.events,
    );
  }

  async updateAgent(agent: AgentRecord): Promise<void> {
    this.state.agents.set(agent.id, agent);
    this.queryCache.upsertAgent(agent);
    await this.writeAgent(agent);
  }

  async loadAgents(): Promise<void> {
    for (const parsedAgent of await this.agentRepository.loadAll()) {
      const needsStatusRecovery = parsedAgent.status === "running";
      const agent: AgentRecord = needsStatusRecovery
        ? {
            ...parsedAgent,
            status: "error",
            updatedAt: new Date().toISOString(),
          }
        : parsedAgent;
      this.state.agents.set(agent.id, agent);
      this.queryCache.upsertAgent(agent);
      if (needsStatusRecovery) await this.writeAgent(agent);
    }
    await this.repairActiveAgentReferences();
  }

  private async repairActiveAgentReferences(): Promise<void> {
    for (const conversation of this.state.conversations.values()) {
      if (!conversation.activeAgentId) continue;
      const active = this.state.agents.get(conversation.activeAgentId);
      if (
        active &&
        !active.parentAgentId &&
        active.conversationId === conversation.id
      ) {
        continue;
      }

      const root = active?.parentAgentId
        ? this.state.agents.get(active.rootAgentId)
        : undefined;
      const repairedAgent =
        root && !root.parentAgentId && root.conversationId === conversation.id
          ? root
          : [...this.state.agents.values()]
              .filter(
                (agent) =>
                  agent.conversationId === conversation.id &&
                  !agent.parentAgentId,
              )
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      await this.updateConversation({
        ...conversation,
        activeAgentId: repairedAgent?.id,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  private async writeAgent(agent: AgentRecord): Promise<void> {
    this.queryCache.upsertAgent(agent);
    await this.agentRepository.write(agent);
  }
}
