import type { Message } from "@earendil-works/pi-ai";
import { buildSessionContext, convertToLlm } from "@nerve/agent";
import type {
  AgentRecord,
  ProjectRecord,
  SessionEntry,
  SessionRecord,
} from "@nerve/shared";
import type { HarnessManager } from "./harness-manager.js";
import type { EntryRepository } from "./repositories/index.js";

export class ConversationService {
  readonly agentConversationCache = new Map<string, Message[]>();

  constructor(
    private readonly harnessManager: HarnessManager,
    private readonly entryRepository: EntryRepository,
  ) {}

  async rebuildAll(
    projects: Iterable<ProjectRecord>,
    sessions: Iterable<SessionRecord>,
    agents: Iterable<AgentRecord>,
    entriesBySessionId: Map<string, SessionEntry[]>,
  ): Promise<void> {
    this.agentConversationCache.clear();
    const projectsById = new Map(
      [...projects].map((project) => [project.id, project]),
    );
    const sessionMessages = new Map<string, Message[]>();
    for (const session of sessions) {
      const project = projectsById.get(session.projectId);
      if (!project) continue;
      const messages = await this.contextMessagesForSession(
        session,
        project.dir,
        entriesBySessionId,
      );
      sessionMessages.set(session.id, messages);
    }
    for (const agent of agents) {
      this.agentConversationCache.set(
        agent.id,
        sessionMessages.get(agent.sessionId) ?? [],
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

  async contextMessagesForSession(
    session: SessionRecord,
    projectDir: string,
    entriesBySessionId: Map<string, SessionEntry[]>,
  ): Promise<Message[]> {
    try {
      const storage = await this.harnessManager.openStorage(
        session,
        projectDir,
      );
      const branch = await storage.getPathToRoot(await storage.getLeafId());
      return convertToLlm(buildSessionContext(branch).messages);
    } catch (error) {
      this.harnessManager.warnMirror(error);
      return this.entryRepository
        .activeBranchEntries(entriesBySessionId, session)
        .filter((entry) => entry.role === "user" || entry.role === "assistant")
        .map((entry) => ({
          role: entry.role,
          content: entry.text,
          timestamp: new Date(entry.createdAt).getTime(),
        })) as Message[];
    }
  }
}
