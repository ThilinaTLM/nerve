import type { Message } from "@earendil-works/pi-ai";
import {
  type AgentMessage,
  Conversation,
  JsonlConversationStorage,
  NodeExecutionEnv,
} from "@nervekit/agent-runtime";
import type {
  AgentRecord,
  ConversationEntry,
  ConversationRecord,
  ProjectRecord,
} from "@nervekit/contracts";
import { pathExists } from "../../infrastructure/storage/index.js";
import type { ConversationRepository } from "./index.js";

export class HarnessManager {
  constructor(
    private readonly conversationRepository: ConversationRepository,
    private readonly getConversation: (
      conversationId: string,
    ) => ConversationRecord,
    private readonly getProject: (projectId: string) => ProjectRecord,
  ) {}

  async openStorage(
    conversation: ConversationRecord,
    cwd: string,
  ): Promise<JsonlConversationStorage> {
    await this.createConversation(conversation, cwd);
    return JsonlConversationStorage.open(
      new NodeExecutionEnv({ cwd }),
      this.conversationPath(conversation.id),
    );
  }

  async createConversation(
    conversation: ConversationRecord,
    cwd: string,
  ): Promise<void> {
    try {
      const path = this.conversationPath(conversation.id);
      if (await pathExists(path)) return;
      const env = new NodeExecutionEnv({ cwd });
      await JsonlConversationStorage.create(env, path, {
        cwd,
        conversationId: conversation.id,
      });
    } catch (error) {
      this.warnMirror(error);
    }
  }

  async appendAgentMessage(
    agent: AgentRecord,
    message: AgentMessage,
  ): Promise<{ id: string; timestamp: string }> {
    const conversation = this.getConversation(agent.conversationId);
    const project = this.getProject(conversation.projectId);
    const storage = await this.openStorage(conversation, project.dir);
    const harnessConversation = new Conversation(storage);
    const id = await harnessConversation.appendMessage(message);
    const entry = await storage.getEntry(id);
    return {
      id,
      timestamp: entry?.timestamp ?? new Date().toISOString(),
    };
  }

  async appendAgentMessageWithId(
    agent: AgentRecord,
    id: string,
    message: AgentMessage,
    timestamp = new Date().toISOString(),
  ): Promise<{ id: string; timestamp: string }> {
    const conversation = this.getConversation(agent.conversationId);
    const project = this.getProject(conversation.projectId);
    const storage = await this.openStorage(conversation, project.dir);
    const harnessConversation = new Conversation(storage);
    await harnessConversation.appendMessageWithId(id, message, timestamp);
    const entry = await storage.getEntry(id);
    return {
      id,
      timestamp: entry?.timestamp ?? timestamp,
    };
  }

  async appendHarnessMessageWithId(
    agent: AgentRecord,
    id: string,
    message: AgentMessage,
    timestamp = new Date().toISOString(),
  ): Promise<{ id: string; timestamp: string }> {
    const conversation = this.getConversation(agent.conversationId);
    const project = this.getProject(conversation.projectId);
    const storage = await this.openStorage(conversation, project.dir);
    const harnessConversation = new Conversation(storage);
    await harnessConversation.appendHarnessMessageWithId(
      id,
      message,
      timestamp,
    );
    const entry = await storage.getEntry(id);
    return {
      id,
      timestamp: entry?.timestamp ?? timestamp,
    };
  }

  async appendEntry(entry: ConversationEntry): Promise<void> {
    if (entry.role === "system") return;
    try {
      const conversation = this.getConversation(entry.conversationId);
      const project = this.getProject(conversation.projectId);
      await this.createConversation(conversation, project.dir);
      const storage = await JsonlConversationStorage.open(
        new NodeExecutionEnv({ cwd: project.dir }),
        this.conversationPath(conversation.id),
      );
      await storage.appendEntry({
        type: "message",
        id: entry.id,
        parentId: entry.parentEntryId ?? null,
        timestamp: entry.createdAt,
        message: {
          role: entry.role,
          content: entry.text,
          timestamp: new Date(entry.createdAt).getTime(),
        } as Message,
      });
    } catch (error) {
      this.warnMirror(error);
    }
  }

  async appendSummaryEntry(
    agent: AgentRecord,
    entry: ConversationEntry,
    fromId: string,
  ): Promise<void> {
    try {
      const conversation = this.getConversation(entry.conversationId);
      const project = this.getProject(conversation.projectId);
      const storage = await this.openStorage(conversation, project.dir);
      await storage.appendEntry({
        type: "branch_summary",
        id: entry.id,
        parentId: entry.parentEntryId ?? null,
        timestamp: entry.createdAt,
        fromId,
        summary: entry.summary ?? entry.text,
        details: { sourceDetails: entry.details, agentId: agent.id },
        fromHook: true,
      });
    } catch (error) {
      this.warnMirror(error);
    }
  }

  async setLeaf(
    conversation: ConversationRecord,
    entryId: string | undefined,
  ): Promise<void> {
    try {
      const project = this.getProject(conversation.projectId);
      await this.createConversation(conversation, project.dir);
      const storage = await JsonlConversationStorage.open(
        new NodeExecutionEnv({ cwd: project.dir }),
        this.conversationPath(conversation.id),
      );
      await storage.setLeafId(entryId ?? null);
    } catch (error) {
      this.warnMirror(error);
    }
  }

  warnMirror(error: unknown): void {
    process.emitWarning(
      `Failed to update harness JSONL conversation mirror: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  conversationPath(conversationId: string): string {
    return this.conversationRepository.harnessPath(conversationId);
  }
}
