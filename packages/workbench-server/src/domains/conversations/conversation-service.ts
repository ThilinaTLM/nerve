import type { Message } from "@earendil-works/pi-ai";
import { convertToLlm } from "@nervekit/harness/messages";
import type { AgentRecord } from "@nervekit/contracts/agents";
import type {
  ConversationEntry,
  ConversationRecord,
} from "@nervekit/contracts/conversations";
import type { ProjectRecord } from "@nervekit/contracts/projects";
import type { ConversationHarnessStorage } from "./conversation-harness-storage.js";
import type { EntryRepository } from "./index.js";
import {
  ModelHistoryInvalidError,
  validateModelHistoryPath,
  modelHistoryIntegrityError,
} from "./model-history-navigation.js";

export class ConversationService {
  readonly agentConversationCache = new Map<string, Message[]>();

  constructor(
    private readonly harnessStorage: ConversationHarnessStorage,
    private readonly entryRepository: EntryRepository,
  ) {}

  async rebuildAll(
    projects: Iterable<ProjectRecord>,
    conversations: Iterable<ConversationRecord>,
    agents: Iterable<AgentRecord>,
    entriesByConversationId: Map<string, ConversationEntry[]>,
  ): Promise<void> {
    this.agentConversationCache.clear();
    const projectsById = new Map(
      [...projects].map((project) => [project.id, project]),
    );
    const conversationMessages = new Map<string, Message[]>();
    await Promise.all(
      [...conversations].map(async (conversation) => {
        const project = projectsById.get(conversation.projectId);
        if (!project) return;
        try {
          const messages = await this.contextMessagesForConversation(
            conversation,
            project.dir,
            entriesByConversationId,
          );
          conversationMessages.set(conversation.id, messages);
        } catch (error) {
          // Historical invalid selections remain readable/unavailable. They
          // cannot prevent rebuilding unrelated, verified conversations.
          if (!(error instanceof ModelHistoryInvalidError)) throw error;
        }
      }),
    );
    for (const agent of agents) {
      const messages = conversationMessages.get(agent.conversationId);
      if (messages) this.agentConversationCache.set(agent.id, messages);
    }
  }

  async rebuildConversation(
    project: ProjectRecord,
    conversation: ConversationRecord,
    agents: Iterable<AgentRecord>,
    entries: ConversationEntry[],
  ): Promise<void> {
    const affected = [...agents].filter(
      (agent) => agent.conversationId === conversation.id,
    );
    try {
      const messages = await this.contextMessagesForConversation(
        conversation,
        project.dir,
        new Map([[conversation.id, entries]]),
      );
      for (const agent of affected)
        this.agentConversationCache.set(agent.id, messages);
    } catch (error) {
      if (error instanceof ModelHistoryInvalidError)
        for (const agent of affected) this.deleteAgent(agent.id);
      throw error;
    }
  }

  getForAgent(agentId: string): Message[] | undefined {
    return this.agentConversationCache.get(agentId);
  }

  setForAgent(agentId: string, messages: Message[]): void {
    this.agentConversationCache.set(agentId, messages);
  }

  deleteAgent(agentId: string): void {
    this.agentConversationCache.delete(agentId);
  }

  clear(): void {
    this.agentConversationCache.clear();
  }

  async contextMessagesForConversation(
    conversation: ConversationRecord,
    projectDir: string,
    entriesByConversationId: Map<string, ConversationEntry[]>,
  ): Promise<Message[]> {
    try {
      const storage = await this.harnessStorage.openStorage(conversation);
      validateModelHistoryPath(
        new Map((await storage.getEntries()).map((entry) => [entry.id, entry])),
        await storage.getLeafId(),
      );
      return convertToLlm((await storage.buildContext()).messages);
    } catch (error) {
      // Invalid authority is not a cache/mirror availability failure. Never
      // substitute transcript rows for an unverifiable model-context path.
      const invalidHistory = modelHistoryIntegrityError(error);
      if (invalidHistory) throw invalidHistory;
      this.harnessStorage.warnMirror(error);
      return this.entryRepository
        .activeBranchEntries(entriesByConversationId, conversation)
        .filter((entry) => entry.role === "user" || entry.role === "assistant")
        .map((entry) => ({
          role: entry.role,
          content: entry.text,
          timestamp: new Date(entry.createdAt).getTime(),
        })) as Message[];
    }
  }
}
