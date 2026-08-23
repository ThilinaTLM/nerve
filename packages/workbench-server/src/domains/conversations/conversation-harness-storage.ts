import { randomUUID } from "node:crypto";
import type { Message } from "@earendil-works/pi-ai";
import {
  type AgentMessage,
  Conversation,
  type ConversationStorage,
  type ConversationTreeEntry,
  type JsonlConversationMetadata,
} from "@nervekit/harness";
import type {
  AgentRecord,
  ConversationEntry,
  ConversationRecord,
  ProjectRecord,
} from "@nervekit/contracts";
import type { ConversationRepository } from "./index.js";

export class ConversationHarnessStorage {
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
  ): Promise<ConversationStorage<JsonlConversationMetadata>> {
    await this.conversationRepository.journal.load(conversation.id);
    return new JournalConversationStorage(
      this.conversationRepository,
      conversation.id,
      cwd,
      conversation.createdAt,
    );
  }

  async openAgentStorage(
    agent: AgentRecord,
  ): Promise<ConversationStorage<JsonlConversationMetadata>> {
    const conversation = this.getConversation(agent.conversationId);
    await this.conversationRepository.journal.load(conversation.id);
    return new JournalConversationStorage(
      this.conversationRepository,
      conversation.id,
      agent.projectDir,
      conversation.createdAt,
      agent.id,
    );
  }

  async createConversation(
    conversation: ConversationRecord,
    cwd: string,
  ): Promise<void> {
    await this.openStorage(conversation, cwd);
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
    return { id, timestamp: entry?.timestamp ?? timestamp };
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
    return { id, timestamp: entry?.timestamp ?? timestamp };
  }

  async appendEntry(entry: ConversationEntry): Promise<void> {
    if (entry.role === "system") return;
    const conversation = this.getConversation(entry.conversationId);
    const project = this.getProject(conversation.projectId);
    const storage = await this.openStorage(conversation, project.dir);
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
  }

  async appendSummaryEntry(
    agent: AgentRecord,
    entry: ConversationEntry,
    fromId: string,
  ): Promise<void> {
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
  }

  async setLeaf(
    conversation: ConversationRecord,
    entryId: string | undefined,
  ): Promise<void> {
    const project = this.getProject(conversation.projectId);
    const storage = await this.openStorage(conversation, project.dir);
    await storage.setLeafId(entryId ?? null);
  }

  warnMirror(error: unknown): void {
    process.emitWarning(
      `Failed to update conversation model context: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  async modelEntries(
    conversationId: string,
    ownerAgentId?: string,
  ): Promise<ConversationTreeEntry[]> {
    const state =
      await this.conversationRepository.journal.load(conversationId);
    return [
      ...(ownerAgentId
        ? (state.agentModelEntries.get(ownerAgentId) ?? [])
        : state.modelEntries),
    ];
  }
}

class JournalConversationStorage implements ConversationStorage<JsonlConversationMetadata> {
  constructor(
    private readonly conversations: ConversationRepository,
    private readonly conversationId: string,
    private readonly cwd: string,
    private readonly createdAt: string,
    private readonly ownerAgentId?: string,
  ) {}

  async getMetadata(): Promise<JsonlConversationMetadata> {
    return {
      id: this.conversationId,
      createdAt: this.createdAt,
      cwd: this.cwd,
      path: this.conversations.journal.journalPath(this.conversationId),
    };
  }

  async getLeafId(): Promise<string | null> {
    const state = await this.conversations.journal.load(this.conversationId);
    return this.ownerAgentId
      ? (state.agentModelLeafIds.get(this.ownerAgentId) ?? null)
      : state.modelLeafId;
  }

  async setLeafId(leafId: string | null): Promise<void> {
    await this.conversations.journal.commit(this.conversationId, {
      kind: "model_context.leaf_changed",
      events: [
        {
          kind: "model_context.leaf_changed",
          conversationId: this.conversationId,
          ownerAgentId: this.ownerAgentId,
          entryId: leafId,
        },
      ],
    });
  }

  async createEntryId(): Promise<string> {
    return `entry_${randomUUID()}`;
  }

  async appendEntry(entry: ConversationTreeEntry): Promise<void> {
    const state = await this.conversations.journal.load(this.conversationId);
    const entries = this.ownerAgentId
      ? (state.agentModelEntries.get(this.ownerAgentId) ?? [])
      : state.modelEntries;
    if (entries.some((candidate) => candidate.id === entry.id)) {
      throw new Error(`Duplicate model-context entry '${entry.id}'.`);
    }
    if (
      entry.parentId !== null &&
      !entries.some((candidate) => candidate.id === entry.parentId)
    ) {
      throw new Error(`Unknown model-context parent '${entry.parentId}'.`);
    }
    await this.conversations.journal.commit(this.conversationId, {
      kind: "model_context.entry_appended",
      events: [
        {
          kind: "model_context.entry_appended",
          conversationId: this.conversationId,
          ownerAgentId: this.ownerAgentId,
          entry: entry as never,
        },
      ],
    });
  }

  async getEntry(id: string): Promise<ConversationTreeEntry | undefined> {
    return (await this.entries()).find((entry) => entry.id === id);
  }

  async findEntries<TType extends ConversationTreeEntry["type"]>(
    type: TType,
  ): Promise<Array<Extract<ConversationTreeEntry, { type: TType }>>> {
    return (await this.entries()).filter(
      (entry): entry is Extract<ConversationTreeEntry, { type: TType }> =>
        entry.type === type,
    );
  }

  async getLabel(id: string): Promise<string | undefined> {
    const labels = (await this.entries()).filter(
      (entry): entry is Extract<ConversationTreeEntry, { type: "label" }> =>
        entry.type === "label" && entry.targetId === id,
    );
    return labels.at(-1)?.label;
  }

  async getPathToRoot(leafId: string | null): Promise<ConversationTreeEntry[]> {
    if (leafId === null) return [];
    const entries = await this.entries();
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const path: ConversationTreeEntry[] = [];
    const visited = new Set<string>();
    let cursor: string | null = leafId;
    while (cursor) {
      if (visited.has(cursor))
        throw new Error("Model-context tree has a cycle.");
      visited.add(cursor);
      const entry = byId.get(cursor);
      if (!entry) throw new Error(`Unknown model-context entry '${cursor}'.`);
      path.push(entry);
      cursor = entry.parentId;
    }
    return path.reverse();
  }

  async getEntries(): Promise<ConversationTreeEntry[]> {
    return this.entries();
  }

  private async entries(): Promise<ConversationTreeEntry[]> {
    const state = await this.conversations.journal.load(this.conversationId);
    return [
      ...(this.ownerAgentId
        ? (state.agentModelEntries.get(this.ownerAgentId) ?? [])
        : state.modelEntries),
    ];
  }
}
