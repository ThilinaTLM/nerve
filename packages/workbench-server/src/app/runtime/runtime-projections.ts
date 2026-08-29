import type { Message } from "@earendil-works/pi-ai";
import { type AgentRecord } from "@nervekit/contracts/agents";
import {
  type ConversationEntry,
  type ConversationRecord,
} from "@nervekit/contracts/conversations";
import { type ProjectRecord } from "@nervekit/contracts/projects";
import { ConversationRuntime } from "../../domains/runs/runtime/conversation-runtime.js";
import { ApplicationError } from "../../core/application-error.js";

export class RuntimeState {
  readonly projects = new Map<string, ProjectRecord>();
  readonly conversations = new Map<string, ConversationRecord>();
  readonly agents = new Map<string, AgentRecord>();
  readonly entries = new Map<string, ConversationEntry[]>();
  private readonly entriesById = new Map<
    string,
    Map<string, ConversationEntry>
  >();
  readonly conversationRuntime = new ConversationRuntime();
  agentConversationMessages = new Map<string, Message[]>();

  listProjects(): ProjectRecord[] {
    return [...this.projects.values()].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
  }

  getProject(projectId: string): ProjectRecord {
    const project = this.projects.get(projectId);
    if (!project)
      throw new ApplicationError(
        404,
        "PROJECT_NOT_FOUND",
        "Project not found.",
      );
    return project;
  }

  listConversations(): ConversationRecord[] {
    return [...this.conversations.values()].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
  }

  getConversation(conversationId: string): ConversationRecord {
    const conversation = this.conversations.get(conversationId);
    if (!conversation)
      throw new ApplicationError(
        404,
        "CONVERSATION_NOT_FOUND",
        "Conversation not found.",
      );
    return conversation;
  }

  listAgents(): AgentRecord[] {
    return [...this.agents.values()].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
  }

  getAgent(agentId: string): AgentRecord {
    const agent = this.agents.get(agentId);
    if (!agent)
      throw new ApplicationError(404, "AGENT_NOT_FOUND", "Agent not found.");
    return agent;
  }

  getConversationEntry(
    conversationId: string,
    entryId: string,
  ): ConversationEntry | undefined {
    return this.entriesById.get(conversationId)?.get(entryId);
  }

  appendConversationEntry(entry: ConversationEntry): boolean {
    let entriesById = this.entriesById.get(entry.conversationId);
    if (!entriesById) {
      entriesById = new Map();
      this.entriesById.set(entry.conversationId, entriesById);
    }
    if (entriesById.has(entry.id)) return false;
    entriesById.set(entry.id, entry);
    let entries = this.entries.get(entry.conversationId);
    if (!entries) {
      entries = [];
      this.entries.set(entry.conversationId, entries);
    }
    entries.push(entry);
    return true;
  }

  getConversationEntries(conversationId: string): ConversationEntry[] {
    return this.entries.get(conversationId) ?? [];
  }

  setProject(project: ProjectRecord): void {
    this.projects.set(project.id, project);
  }

  setConversation(conversation: ConversationRecord): void {
    this.conversations.set(conversation.id, conversation);
  }

  setAgent(agent: AgentRecord): void {
    this.agents.set(agent.id, agent);
  }

  setConversationEntries(
    conversationId: string,
    entries: ConversationEntry[],
  ): void {
    this.entries.set(conversationId, entries);
    this.entriesById.set(
      conversationId,
      new Map(entries.map((entry) => [entry.id, entry])),
    );
  }

  removeProject(projectId: string): void {
    this.projects.delete(projectId);
  }

  removeConversation(conversationId: string): void {
    this.conversations.delete(conversationId);
    this.entries.delete(conversationId);
    this.entriesById.delete(conversationId);
  }

  removeAgent(agentId: string): void {
    this.agents.delete(agentId);
  }

  rebuildConversations(conversations: ConversationRecord[]): void {
    this.conversations.clear();
    for (const conversation of conversations) {
      this.conversations.set(conversation.id, conversation);
    }
  }

  useAgentConversationMessages(cache: Map<string, Message[]>): void {
    this.agentConversationMessages = cache;
  }
}
