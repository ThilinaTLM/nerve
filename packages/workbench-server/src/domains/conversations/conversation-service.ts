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
        const messages = await this.contextMessagesForConversation(
          conversation,
          project.dir,
          entriesByConversationId,
        );
        conversationMessages.set(conversation.id, messages);
      }),
    );
    for (const agent of agents) {
      this.agentConversationCache.set(
        agent.id,
        conversationMessages.get(agent.conversationId) ?? [],
      );
    }
  }

  async rebuildConversation(
    project: ProjectRecord,
    conversation: ConversationRecord,
    agents: Iterable<AgentRecord>,
    entries: ConversationEntry[],
  ): Promise<void> {
    const messages = await this.contextMessagesForConversation(
      conversation,
      project.dir,
      new Map([[conversation.id, entries]]),
    );
    for (const agent of agents) {
      if (agent.conversationId === conversation.id) {
        this.agentConversationCache.set(agent.id, messages);
      }
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
      return convertToLlm((await storage.buildContext()).messages);
    } catch (error) {
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
