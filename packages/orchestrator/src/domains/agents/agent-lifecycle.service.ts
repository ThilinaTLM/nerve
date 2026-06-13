import { resolve } from "node:path";
import { clampAgentThinkingLevel } from "@nerve/agent";
import {
  type AgentRecord,
  type ConversationRecord,
  type CreateAgentRequest,
  createId,
  type Mode,
  type ProjectRecord,
  type UpdateAgentRequest,
} from "@nerve/shared";
import { HttpError } from "../../http/errors.js";
import type { EventBus } from "../../infrastructure/events/index.js";
import type { IndexStore } from "../../infrastructure/index-store/index.js";
import type { InitializedStorage } from "../../infrastructure/storage/index.js";
import type { AgentStatus } from "../../registry/types.js";
import type { ConversationService } from "../conversations/conversation-service.js";
import type { WorkerManager } from "../workers/worker-manager.js";
import type { AgentRepository } from "./agent.repository.js";
import { assertChildAuthority } from "./agent-authority.js";
import { agentBudget } from "./agent-budget.js";
import { setAgentStatus as setAgentStatusHelper } from "./agent-status.js";
import type { AgentRunState } from "./run/index.js";

function isModeOnlyUpdate(
  request: UpdateAgentRequest,
): request is UpdateAgentRequest & { mode: Mode } {
  return (
    request.mode !== undefined &&
    request.permissionLevel === undefined &&
    request.model === undefined &&
    request.thinkingLevel === undefined
  );
}

export class AgentLifecycleService {
  constructor(
    private readonly storage: InitializedStorage,
    private readonly events: EventBus,
    private readonly index: IndexStore,
    private readonly agents: Map<string, AgentRecord>,
    private readonly runs: Map<string, AgentRunState>,
    private readonly agentRepository: AgentRepository,
    private readonly workers: WorkerManager,
    private readonly conversationService: ConversationService,
    private readonly getConversation: (
      conversationId: string,
    ) => ConversationRecord,
    private readonly getProject: (projectId: string) => ProjectRecord,
    private readonly updateConversation: (
      conversation: ConversationRecord,
    ) => Promise<void>,
    private readonly abortAgent: (agentId: string) => Promise<void>,
  ) {}

  async createAgent(
    request: CreateAgentRequest,
    options: { allowChildAuthorityExceed?: boolean } = {},
  ): Promise<AgentRecord> {
    const conversation = this.getConversation(request.conversationId);
    const project = this.getProject(request.projectId);
    const parent = request.parentAgentId
      ? this.agents.get(request.parentAgentId)
      : undefined;
    if (request.parentAgentId && !parent)
      throw new HttpError(
        404,
        "PARENT_AGENT_NOT_FOUND",
        "Parent agent not found.",
      );

    const now = new Date().toISOString();
    const id = createId("agent");
    const projectDir = resolve(request.projectDir ?? project.dir);
    const mode =
      request.mode ??
      (parent ? this.storage.settings.defaultSubagentMode : conversation.mode);
    const permissionLevel =
      request.permissionLevel ??
      (parent
        ? this.storage.settings.defaultSubagentPermissionLevel
        : conversation.permissionLevel);
    const workerId = this.workers.requireWorker(
      request.workerId ?? parent?.workerId,
      "agent",
    ).id;
    if (parent) {
      assertChildAuthority(
        parent,
        mode,
        permissionLevel,
        Boolean(options.allowChildAuthorityExceed),
      );
      await this.reserveChildRun(parent);
    }
    const agent: AgentRecord = {
      id,
      conversationId: conversation.id,
      projectId: project.id,
      projectDir,
      workerId,
      parentAgentId: request.parentAgentId,
      rootAgentId: parent?.rootAgentId ?? id,
      mode,
      permissionLevel,
      workspaceScope: request.workspaceScope ?? { roots: [projectDir] },
      budget: agentBudget(parent, request.budget),
      model: request.model,
      thinkingLevel: clampAgentThinkingLevel(
        request.model,
        request.thinkingLevel,
      ),
      status: "idle",
      createdAt: now,
      updatedAt: now,
    };
    this.agents.set(agent.id, agent);
    this.index.upsertAgent(agent);
    await this.writeAgent(agent);
    await this.updateConversation({
      ...conversation,
      activeAgentId: agent.id,
      updatedAt: now,
    });
    await this.events.publish("agent.created", { agent, task: request.task });
    return agent;
  }

  listAgents(): AgentRecord[] {
    return [...this.agents.values()].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
  }

  getAgent(agentId: string): AgentRecord {
    const agent = this.agents.get(agentId);
    if (!agent) throw new HttpError(404, "AGENT_NOT_FOUND", "Agent not found.");
    return agent;
  }

  async removeAgentInternal(agentId: string): Promise<void> {
    if (!this.agents.has(agentId)) return;
    if (this.runs.has(agentId)) await this.abortAgent(agentId);
    for (const child of [...this.agents.values()].filter(
      (candidate) => candidate.parentAgentId === agentId,
    )) {
      await this.removeAgentInternal(child.id);
    }
    this.agents.delete(agentId);
    this.conversationService.deleteAgent(agentId);
    this.runs.delete(agentId);
    this.index.removeAgent(agentId);
    await this.agentRepository.remove(agentId);
  }

  async configureAgent(
    agentId: string,
    request: UpdateAgentRequest,
  ): Promise<AgentRecord> {
    const agent = this.getAgent(agentId);
    if (this.runs.has(agent.id)) {
      if (isModeOnlyUpdate(request)) {
        return this.setAgentModeInternal(
          agent.id,
          request.mode,
          "Mode changed by user.",
        );
      }
      throw new HttpError(409, "AGENT_BUSY", "Cannot update a running agent.");
    }
    const model =
      request.model === null ? undefined : (request.model ?? agent.model);
    const updated: AgentRecord = {
      ...agent,
      mode: request.mode ?? agent.mode,
      permissionLevel: request.permissionLevel ?? agent.permissionLevel,
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
    await this.runs.get(agentId)?.updateAgentRuntimeConfig?.(updated);
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
    this.agents.set(agent.id, agent);
    this.index.upsertAgent(agent);
    await this.writeAgent(agent);
  }

  async loadAgents(): Promise<void> {
    for (const parsedAgent of await this.agentRepository.loadAll()) {
      const localWorkerId = this.workers.requireDefaultLocalWorker().id;
      const needsStatusRecovery = parsedAgent.status === "running";
      const needsWorkerBackfill = !parsedAgent.workerId;
      const agent: AgentRecord =
        needsStatusRecovery || needsWorkerBackfill
          ? {
              ...parsedAgent,
              workerId: parsedAgent.workerId ?? localWorkerId,
              status: needsStatusRecovery ? "error" : parsedAgent.status,
              updatedAt: needsStatusRecovery
                ? new Date().toISOString()
                : parsedAgent.updatedAt,
            }
          : parsedAgent;
      this.agents.set(agent.id, agent);
      this.index.upsertAgent(agent);
      if (needsStatusRecovery || needsWorkerBackfill)
        await this.writeAgent(agent);
    }
  }

  private async reserveChildRun(parent: AgentRecord): Promise<void> {
    const latest = this.getAgent(parent.id);
    const updated: AgentRecord = {
      ...latest,
      budget: {
        ...latest.budget,
        usedRuns: latest.budget.usedRuns + 1,
      },
      updatedAt: new Date().toISOString(),
    };
    await this.updateAgent(updated);
  }

  private async writeAgent(agent: AgentRecord): Promise<void> {
    this.index.upsertAgent(agent);
    await this.agentRepository.write(agent);
  }
}
