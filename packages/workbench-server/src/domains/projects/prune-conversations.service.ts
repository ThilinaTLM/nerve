import type {
  AgentRecord,
  ConversationRecord,
  ProjectRecord,
  PruneProjectConversationsRequest,
  PruneProjectConversationsResponse,
  TaskRecord,
} from "@nervekit/contracts";
import type { ApplicationLogger } from "../../infrastructure/diagnostics/index.js";
import type { EventBus } from "../../infrastructure/events/index.js";
import type { ConversationRepository } from "../conversations/index.js";

export interface PruneConversationsTaskPort {
  activeTasksForConversations(conversationIds: string[]): TaskRecord[];
  removeInactiveTasksForConversations(
    conversationIds: string[],
  ): Promise<string[]>;
  listTasks(): TaskRecord[];
}

export interface PruneConversationsToolPort {
  removeRecordsForConversations(
    conversationIds: string[],
    agentIds: string[],
  ): Promise<void>;
}
export interface PruneConversationsPlanPort {
  removeReviewsForConversations(conversationIds: string[]): Promise<void>;
}
export interface PruneConversationsSuspensionPort {
  removeSuspensionsForConversations(conversationIds: string[]): Promise<void>;
}

export interface PruneProjectConversationsServiceDeps {
  getProject: (projectId: string) => ProjectRecord;
  listConversations: () => ConversationRecord[];
  agents: Map<string, AgentRecord>;
  tasks: PruneConversationsTaskPort;
  tools: PruneConversationsToolPort;
  plans: PruneConversationsPlanPort;
  suspensions: PruneConversationsSuspensionPort;
  conversationRepository: ConversationRepository;
  removeConversation: (conversationId: string) => Promise<void>;
  rebuildIndex: () => Promise<void>;
  events: EventBus;
  logger: ApplicationLogger;
}

export class PruneProjectConversationsService {
  constructor(private readonly deps: PruneProjectConversationsServiceDeps) {}

  async pruneProjectConversations(
    projectId: string,
    request: PruneProjectConversationsRequest = {
      strategy: "olderThanDays",
      olderThanDays: 7,
    },
  ): Promise<PruneProjectConversationsResponse> {
    const project = this.deps.getProject(projectId);
    return (
      await this.pruneAcrossProjects([project], request)
    )[0] as PruneProjectConversationsResponse;
  }

  async pruneAcrossProjects(
    projects: ProjectRecord[],
    request: PruneProjectConversationsRequest,
  ): Promise<PruneProjectConversationsResponse[]> {
    const projectIds = new Set(projects.map((project) => project.id));
    const projectConversations = this.deps
      .listConversations()
      .filter((conversation) => projectIds.has(conversation.projectId));
    const candidates = this.pruneCandidatesByProject(
      projectConversations,
      request,
    );
    const candidateIds = candidates.map((conversation) => conversation.id);
    const activeTaskConversationIds = new Set(
      this.deps.tasks
        .activeTasksForConversations(candidateIds)
        .map((task) => task.conversationId)
        .filter((id): id is string => Boolean(id)),
    );
    const agentsByConversationId = this.agentsByConversation(candidateIds);
    const pruned: ConversationRecord[] = [];
    const skippedByProject = new Map<
      string,
      PruneProjectConversationsResponse["skipped"]
    >();
    const prunedAgentIds: string[] = [];

    for (const conversation of candidates) {
      const agents = agentsByConversationId.get(conversation.id) ?? [];
      const skipped = skippedByProject.get(conversation.projectId) ?? [];
      if (
        agents.some(
          (agent) =>
            agent.status === "running" || agent.status === "awaiting_user",
        )
      ) {
        skipped.push({
          conversationId: conversation.id,
          reason: "active_agent",
        });
        skippedByProject.set(conversation.projectId, skipped);
        continue;
      }
      if (activeTaskConversationIds.has(conversation.id)) {
        skipped.push({
          conversationId: conversation.id,
          reason: "active_task",
        });
        skippedByProject.set(conversation.projectId, skipped);
        continue;
      }
      pruned.push(conversation);
      prunedAgentIds.push(...agents.map((agent) => agent.id));
    }

    const prunedIds = pruned.map((conversation) => conversation.id);
    const taskProjectById = new Map(
      this.deps.tasks.listTasks().map((task) => [task.id, task.projectId]),
    );
    const prunedTaskIds =
      await this.deps.tasks.removeInactiveTasksForConversations(prunedIds);
    await this.deps.tools.removeRecordsForConversations(
      prunedIds,
      prunedAgentIds,
    );
    await this.deps.plans.removeReviewsForConversations(prunedIds);
    await this.deps.suspensions.removeSuspensionsForConversations(prunedIds);
    for (const conversation of pruned)
      await this.deps.removeConversation(conversation.id);
    // removeConversation publishes a deletion event into the per-conversation
    // log, which recreates the directory. Remove the final persisted trace.
    await Promise.all(
      prunedIds.map((conversationId) =>
        this.deps.conversationRepository
          .remove(conversationId)
          .catch(() => undefined),
      ),
    );
    await this.deps.events.removeEventsForConversations(prunedIds);
    await this.deps.logger.removeLogsForConversations(prunedIds);
    if (prunedIds.length > 0) await this.deps.rebuildIndex();

    const responses = projects.map((project) => {
      const response: PruneProjectConversationsResponse = {
        projectId: project.id,
        strategy: request.strategy,
        prunedConversationIds: pruned
          .filter((conversation) => conversation.projectId === project.id)
          .map((conversation) => conversation.id),
        prunedTaskIds: prunedTaskIds.filter(
          (taskId) => taskProjectById.get(taskId) === project.id,
        ),
        skipped: skippedByProject.get(project.id) ?? [],
      };
      return response;
    });
    for (const response of responses) {
      await this.deps.events.publish("project.conversations.pruned", response);
    }
    return responses;
  }

  private pruneCandidatesByProject(
    conversations: ConversationRecord[],
    request: PruneProjectConversationsRequest,
  ): ConversationRecord[] {
    if (request.strategy === "olderThanDays") {
      const cutoffMs = Date.now() - request.olderThanDays * 86_400_000;
      return conversations.filter((conversation) => {
        const updatedAt = Date.parse(conversation.updatedAt);
        return Number.isFinite(updatedAt) && updatedAt < cutoffMs;
      });
    }
    const byProject = new Map<string, ConversationRecord[]>();
    for (const conversation of conversations) {
      const values = byProject.get(conversation.projectId) ?? [];
      values.push(conversation);
      byProject.set(conversation.projectId, values);
    }
    return [...byProject.values()].flatMap((values) =>
      values
        .sort(
          (left, right) =>
            Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
        )
        .slice(request.keepLatest),
    );
  }

  private agentsByConversation(
    conversationIds: string[],
  ): Map<string, AgentRecord[]> {
    const candidateIds = new Set(conversationIds);
    const result = new Map<string, AgentRecord[]>();
    for (const agent of this.deps.agents.values()) {
      if (!candidateIds.has(agent.conversationId)) continue;
      const values = result.get(agent.conversationId) ?? [];
      values.push(agent);
      result.set(agent.conversationId, values);
    }
    return result;
  }
}
