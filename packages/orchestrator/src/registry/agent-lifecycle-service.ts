import { resolve } from "node:path";
import {
  type AgentRecord,
  type CreateAgentRequest,
  createId,
  type ProjectRecord,
  type SessionRecord,
  type UpdateAgentRequest,
} from "@nerve/shared";
import type { AgentRunState } from "../agent-runner/index.js";
import { assertChildAuthority } from "../agents/agent-authority.js";
import { agentBudget } from "../agents/agent-budget.js";
import { setAgentStatus as setAgentStatusHelper } from "../agents/agent-status.js";
import type { ConversationService } from "../conversation-service.js";
import type { EventBus } from "../events.js";
import { HttpError } from "../http/errors.js";
import type { IndexStore } from "../index-store.js";
import type { AgentRepository } from "../repositories/index.js";
import type { InitializedStorage } from "../storage.js";
import type { WorkerManager } from "../worker-manager.js";
import type { AgentStatus } from "./types.js";

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
    private readonly getSession: (sessionId: string) => SessionRecord,
    private readonly getProject: (projectId: string) => ProjectRecord,
    private readonly updateSession: (session: SessionRecord) => Promise<void>,
    private readonly abortAgent: (agentId: string) => Promise<void>,
  ) {}

  async createAgent(
    request: CreateAgentRequest,
    options: { allowChildAuthorityExceed?: boolean } = {},
  ): Promise<AgentRecord> {
    const session = this.getSession(request.sessionId);
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
      (parent ? this.storage.settings.defaultSubagentMode : session.mode);
    const permissionLevel =
      request.permissionLevel ??
      (parent
        ? this.storage.settings.defaultSubagentPermissionLevel
        : session.permissionLevel);
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
      sessionId: session.id,
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
      status: "idle",
      createdAt: now,
      updatedAt: now,
    };
    this.agents.set(agent.id, agent);
    this.index.upsertAgent(agent);
    await this.writeAgent(agent);
    await this.updateSession({
      ...session,
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
      throw new HttpError(409, "AGENT_BUSY", "Cannot update a running agent.");
    }
    const updated: AgentRecord = {
      ...agent,
      mode: request.mode ?? agent.mode,
      permissionLevel: request.permissionLevel ?? agent.permissionLevel,
      model:
        request.model === null ? undefined : (request.model ?? agent.model),
      updatedAt: new Date().toISOString(),
    };
    await this.updateAgent(updated);
    await this.events.publish("agent.configured", { agent: updated });
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
