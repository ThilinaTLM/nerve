import type { Message } from "@earendil-works/pi-ai";
import {
  type AgentRecord,
  type ConversationEntry,
  type ConversationRecord,
  ConversationRuntime,
  type ProjectRecord,
} from "@nervekit/contracts";
import { HttpError } from "../http/errors.js";

export class RuntimeState {
  readonly projects = new Map<string, ProjectRecord>();
  readonly conversations = new Map<string, ConversationRecord>();
  readonly agents = new Map<string, AgentRecord>();
  readonly entries = new Map<string, ConversationEntry[]>();
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
      throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found.");
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
      throw new HttpError(
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
    if (!agent) throw new HttpError(404, "AGENT_NOT_FOUND", "Agent not found.");
    return agent;
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
  }

  removeProject(projectId: string): void {
    this.projects.delete(projectId);
  }

  removeConversation(conversationId: string): void {
    this.conversations.delete(conversationId);
    this.entries.delete(conversationId);
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
