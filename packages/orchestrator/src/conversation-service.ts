import type { Message } from "@earendil-works/pi-ai";
import { buildConversationContext, convertToLlm } from "@nerve/agent";
import type {
  AgentRecord,
  ConversationEntry,
  ConversationRecord,
  ProjectRecord,
} from "@nerve/shared";
import type { EntryRepository } from "./domains/conversations/index.js";
import type { HarnessManager } from "./harness-manager.js";

export class ConversationService {
  readonly agentConversationCache = new Map<string, Message[]>();

  constructor(
    private readonly harnessManager: HarnessManager,
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
    for (const conversation of conversations) {
      const project = projectsById.get(conversation.projectId);
      if (!project) continue;
      const messages = await this.contextMessagesForConversation(
        conversation,
        project.dir,
        entriesByConversationId,
      );
      conversationMessages.set(conversation.id, messages);
    }
    for (const agent of agents) {
      this.agentConversationCache.set(
        agent.id,
        conversationMessages.get(agent.conversationId) ?? [],
      );
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
      const storage = await this.harnessManager.openStorage(
        conversation,
        projectDir,
      );
      const branch = await storage.getPathToRoot(await storage.getLeafId());
      return convertToLlm(buildConversationContext(branch).messages);
    } catch (error) {
      this.harnessManager.warnMirror(error);
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
