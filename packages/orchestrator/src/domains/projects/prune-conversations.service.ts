import type {
  AgentRecord,
  ConversationRecord,
  ProjectRecord,
  PruneProjectConversationsRequest,
  PruneProjectConversationsResponse,
  TaskRecord,
} from "@nervekit/shared";
import type { ApplicationLogger } from "../../infrastructure/diagnostics/index.js";
import type { EventBus } from "../../infrastructure/events/index.js";
import type { ConversationRepository } from "../conversations/index.js";

export interface PruneConversationsTaskPort {
  activeTasksForConversations(conversationIds: string[]): TaskRecord[];
  removeInactiveTasksForConversations(
    conversationIds: string[],
  ): Promise<string[]>;
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
    this.deps.getProject(projectId);
    const projectConversations = this.deps
      .listConversations()
      .filter((conversation) => conversation.projectId === projectId);
    const candidates = this.pruneCandidates(projectConversations, request);
    const candidateIds = candidates.map((conversation) => conversation.id);
    const activeTaskConversationIds = new Set(
      this.deps.tasks
        .activeTasksForConversations(candidateIds)
        .map((task) => task.conversationId)
        .filter((conversationId): conversationId is string =>
          Boolean(conversationId),
        ),
    );
    const agentsByConversationId = this.agentsByConversation(candidateIds);

    const prunedConversationIds: string[] = [];
    const prunedAgentIds: string[] = [];
    const skipped: PruneProjectConversationsResponse["skipped"] = [];
    for (const conversation of candidates) {
      const agents = agentsByConversationId.get(conversation.id) ?? [];
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
        continue;
      }
      if (activeTaskConversationIds.has(conversation.id)) {
        skipped.push({
          conversationId: conversation.id,
          reason: "active_task",
        });
        continue;
      }
      prunedConversationIds.push(conversation.id);
      prunedAgentIds.push(...agents.map((agent) => agent.id));
    }

    const prunedTaskIds =
      await this.deps.tasks.removeInactiveTasksForConversations(
        prunedConversationIds,
      );
    await this.deps.tools.removeRecordsForConversations(
      prunedConversationIds,
      prunedAgentIds,
    );
    await this.deps.plans.removeReviewsForConversations(prunedConversationIds);
    await this.deps.suspensions.removeSuspensionsForConversations(
      prunedConversationIds,
    );
    for (const conversationId of prunedConversationIds) {
      await this.deps.removeConversation(conversationId);
    }
    await Promise.all(
      prunedConversationIds.map((conversationId) =>
        this.deps.conversationRepository
          .remove(conversationId)
          .catch(() => undefined),
      ),
    );
    await this.deps.events.removeEventsForConversations(prunedConversationIds);
    await this.deps.logger.removeLogsForConversations(prunedConversationIds);
    await this.deps.rebuildIndex();

    const response: PruneProjectConversationsResponse = {
      projectId,
      strategy: request.strategy,
      prunedConversationIds,
      prunedTaskIds,
      skipped,
    };
    await this.deps.events.publish("project.conversations.pruned", response);
    return response;
  }

  private pruneCandidates(
    conversations: ConversationRecord[],
    request: PruneProjectConversationsRequest,
  ): ConversationRecord[] {
    if (request.strategy === "olderThanDays") {
      const cutoffMs = Date.now() - request.olderThanDays * 24 * 60 * 60 * 1000;
      return conversations.filter((conversation) => {
        const updatedAt = Date.parse(conversation.updatedAt);
        return Number.isFinite(updatedAt) && updatedAt < cutoffMs;
      });
    }

    return [...conversations]
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(request.keepLatest);
  }

  private agentsByConversation(
    conversationIds: string[],
  ): Map<string, AgentRecord[]> {
    const candidateIds = new Set(conversationIds);
    const agentsByConversationId = new Map<string, AgentRecord[]>();
    for (const agent of this.deps.agents.values()) {
      if (!candidateIds.has(agent.conversationId)) continue;
      const agents = agentsByConversationId.get(agent.conversationId) ?? [];
      agents.push(agent);
      agentsByConversationId.set(agent.conversationId, agents);
    }
    return agentsByConversationId;
  }
}
