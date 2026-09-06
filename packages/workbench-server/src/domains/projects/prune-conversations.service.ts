import type {
  ConversationRemovalOptions,
  ConversationRemovalProgress,
} from "../conversations/conversation-deletion-progress.js";
import type { AgentRecord } from "@nervekit/contracts/agents";
import type { ConversationRecord } from "@nervekit/contracts/conversations";
import type {
  ProjectRecord,
  PruneProjectConversationSkippedReason,
  PruneProjectConversationsRequest,
  PruneProjectConversationsSummary,
} from "@nervekit/contracts/projects";
import type { TaskRecord } from "@nervekit/contracts/tasks";
import type { ApplicationLogger } from "../../infrastructure/diagnostics/index.js";
import type { StreamLogRegistry } from "../../infrastructure/events/index.js";
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
export interface PruneProjectConversationsResult extends PruneProjectConversationsSummary {
  prunedConversationIds: string[];
  prunedTaskIds: string[];
  skipped: Array<{
    conversationId: string;
    reason: PruneProjectConversationSkippedReason;
  }>;
}

export interface PruneProjectConversationsProgress {
  operationId?: string;
  shouldCancel?: () => boolean;
  onCurrentItem?: (
    progress: ConversationRemovalProgress,
  ) => void | Promise<void>;
  onDiscovered?: (input: {
    totalItems: number;
    skippedActiveAgentCount: number;
    skippedActiveTaskCount: number;
  }) => void | Promise<void>;
  onPhase?: (
    phase: "removing_related_data" | "removing_conversations" | "finalizing",
    message: string,
  ) => void | Promise<void>;
  onConversationRemoved?: (completedItems: number) => void | Promise<void>;
  yieldControl?: () => Promise<void>;
}

export interface PruneProjectConversationsServiceDeps {
  getProject: (projectId: string) => ProjectRecord;
  listConversations: () => ConversationRecord[];
  agents: Map<string, AgentRecord>;
  tasks: PruneConversationsTaskPort;
  tools: PruneConversationsToolPort;
  plans: PruneConversationsPlanPort;
  conversationRepository: ConversationRepository;
  removeConversation: (
    conversationId: string,
    options?: ConversationRemovalOptions,
  ) => Promise<void>;
  events: StreamLogRegistry;
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
    progress: PruneProjectConversationsProgress = {},
  ): Promise<PruneProjectConversationsResult> {
    const project = this.deps.getProject(projectId);
    return (
      await this.pruneAcrossProjects([project], request, progress)
    )[0] as PruneProjectConversationsResult;
  }

  async pruneAcrossProjects(
    projects: ProjectRecord[],
    request: PruneProjectConversationsRequest,
    progress: PruneProjectConversationsProgress = {},
  ): Promise<PruneProjectConversationsResult[]> {
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
      PruneProjectConversationsResult["skipped"]
    >();

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
    }

    const prunedIds = pruned.map((conversation) => conversation.id);
    await progress.onDiscovered?.({
      totalItems: prunedIds.length,
      skippedActiveAgentCount: [...skippedByProject.values()]
        .flat()
        .filter((entry) => entry.reason === "active_agent").length,
      skippedActiveTaskCount: [...skippedByProject.values()]
        .flat()
        .filter((entry) => entry.reason === "active_task").length,
    });
    await progress.onPhase?.(
      "removing_related_data",
      "Removing related task and tool data…",
    );
    const taskProjectById = new Map(
      this.deps.tasks.listTasks().map((task) => [task.id, task.projectId]),
    );
    const prunedTaskIds: string[] = [];
    const removed: ConversationRecord[] = [];
    let completedItems = 0;
    for (const conversation of pruned) {
      if (progress.shouldCancel?.()) break;
      // Eligibility must be checked again at the safe conversation boundary,
      // before deleting any of its task, tool, or review data.
      const agents =
        this.agentsByConversation([conversation.id]).get(conversation.id) ?? [];
      const reason = agents.some(
        (agent) =>
          agent.status === "running" || agent.status === "awaiting_user",
      )
        ? ("active_agent" as const)
        : this.deps.tasks.activeTasksForConversations([conversation.id])
              .length > 0
          ? ("active_task" as const)
          : undefined;
      if (reason) {
        const skipped = skippedByProject.get(conversation.projectId) ?? [];
        skipped.push({ conversationId: conversation.id, reason });
        skippedByProject.set(conversation.projectId, skipped);
        continue;
      }
      await this.deps.removeConversation(conversation.id, {
        operationId: progress.operationId,
        onProgress: progress.onCurrentItem,
        prepare: async () => {
          await progress.onPhase?.(
            "removing_related_data",
            "Removing related task and tool data…",
          );
          prunedTaskIds.push(
            ...(await this.deps.tasks.removeInactiveTasksForConversations([
              conversation.id,
            ])),
          );
          await this.deps.tools.removeRecordsForConversations(
            [conversation.id],
            agents.map((agent) => agent.id),
          );
          await this.deps.plans.removeReviewsForConversations([
            conversation.id,
          ]);
          await progress.onPhase?.(
            "removing_conversations",
            "Removing conversation history…",
          );
        },
      });
      removed.push(conversation);
      completedItems += 1;
      await progress.onConversationRemoved?.(completedItems);
      await progress.yieldControl?.();
    }
    await progress.onPhase?.("finalizing", "Finalizing cleanup…");
    await this.deps.logger.removeLogsForConversations(
      removed.map((conversation) => conversation.id),
    );

    const responses = projects.map((project) => {
      const projectPrunedIds = removed
        .filter((conversation) => conversation.projectId === project.id)
        .map((conversation) => conversation.id);
      const projectPrunedTaskIds = prunedTaskIds.filter(
        (taskId) => taskProjectById.get(taskId) === project.id,
      );
      const skipped = skippedByProject.get(project.id) ?? [];
      const response: PruneProjectConversationsResult = {
        projectId: project.id,
        strategy: request.strategy,
        removedConversationCount: projectPrunedIds.length,
        removedTaskCount: projectPrunedTaskIds.length,
        skippedActiveAgentCount: skipped.filter(
          (entry) => entry.reason === "active_agent",
        ).length,
        skippedActiveTaskCount: skipped.filter(
          (entry) => entry.reason === "active_task",
        ).length,
        prunedConversationIds: projectPrunedIds,
        prunedTaskIds: projectPrunedTaskIds,
        skipped,
      };
      return response;
    });
    for (const response of responses) {
      const summary: PruneProjectConversationsSummary = {
        projectId: response.projectId,
        strategy: response.strategy,
        removedConversationCount: response.removedConversationCount,
        removedTaskCount: response.removedTaskCount,
        skippedActiveAgentCount: response.skippedActiveAgentCount,
        skippedActiveTaskCount: response.skippedActiveTaskCount,
      };
      await this.deps.events.publish("project.conversations.pruned", summary);
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
    if (request.strategy === "completed") {
      return conversations.filter((conversation) => conversation.completedAt);
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
