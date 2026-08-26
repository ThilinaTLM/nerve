import { randomUUID } from "node:crypto";
import type { PerformanceDiagnosticsPort } from "../../core/ports.js";
import { noopPerformanceDiagnostics } from "../../infrastructure/diagnostics/performance-metrics.js";
import type { Message } from "@earendil-works/pi-ai";
import {
  type AgentMessage,
  Conversation,
  ConversationTreeState,
  type ConversationMetadata,
  type ConversationStorage,
  type ConversationTreeEntry,
} from "@nervekit/harness";
import type {
  AgentRecord,
  ConversationEntry,
  ConversationRecord,
} from "@nervekit/contracts";
import type { ConversationRepository } from "./index.js";

export class ConversationHarnessStorage {
  constructor(
    private readonly conversationRepository: ConversationRepository,
    private readonly getConversation: (
      conversationId: string,
    ) => ConversationRecord,
    private readonly diagnostics: PerformanceDiagnosticsPort = noopPerformanceDiagnostics,
  ) {}

  async openStorage(
    conversation: ConversationRecord,
  ): Promise<ConversationStorage<ConversationMetadata>> {
    await this.conversationRepository.journal.load(conversation.id);
    return new JournalConversationStorage(
      this.conversationRepository,
      conversation.id,
      conversation.createdAt,
      undefined,
      this.diagnostics,
    );
  }

  async openAgentStorage(
    agent: AgentRecord,
  ): Promise<ConversationStorage<ConversationMetadata>> {
    const conversation = this.getConversation(agent.conversationId);
    await this.conversationRepository.journal.load(conversation.id);
    return new JournalConversationStorage(
      this.conversationRepository,
      conversation.id,
      conversation.createdAt,
      agent.id,
      this.diagnostics,
    );
  }

  async createConversation(conversation: ConversationRecord): Promise<void> {
    await this.openStorage(conversation);
  }

  async appendAgentMessage(
    agent: AgentRecord,
    message: AgentMessage,
  ): Promise<{ id: string; timestamp: string }> {
    const conversation = this.getConversation(agent.conversationId);
    const storage = await this.openStorage(conversation);
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
    const storage = await this.openStorage(conversation);
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
    const storage = await this.openStorage(conversation);
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
    const storage = await this.openStorage(conversation);
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
    const storage = await this.openStorage(conversation);
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
    const storage = await this.openStorage(conversation);
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

class JournalConversationStorage implements ConversationStorage<ConversationMetadata> {
  constructor(
    private readonly conversations: ConversationRepository,
    private readonly conversationId: string,
    private readonly createdAt: string,
    private readonly ownerAgentId?: string,
    private readonly diagnostics: PerformanceDiagnosticsPort = noopPerformanceDiagnostics,
  ) {}

  async getMetadata(): Promise<ConversationMetadata> {
    return { id: this.conversationId, createdAt: this.createdAt };
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
    const tree = await this.tree();
    if (tree.getEntry(entry.id)) {
      throw new Error(`Duplicate model-context entry '${entry.id}'.`);
    }
    tree.validateAppend(entry);
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
    return (await this.tree()).getEntry(id);
  }

  async findEntries<TType extends ConversationTreeEntry["type"]>(
    type: TType,
  ): Promise<Array<Extract<ConversationTreeEntry, { type: TType }>>> {
    return (await this.tree()).findEntries(type);
  }

  async getLabel(id: string): Promise<string | undefined> {
    return (await this.tree()).getLabel(id);
  }

  async getPathToRoot(leafId: string | null): Promise<ConversationTreeEntry[]> {
    return (await this.tree()).getPathToRoot(leafId);
  }

  async getContextPath(leafId?: string | null) {
    const tree = await this.tree();
    return tree.getContextPath(leafId === undefined ? tree.leafId : leafId);
  }

  async buildContext(leafId?: string | null) {
    const startedAt = performance.now();
    const tree = await this.tree();
    const context = tree.buildContext(
      leafId === undefined ? tree.leafId : leafId,
    );
    this.diagnostics.duration(
      "conversation.contextBuild",
      performance.now() - startedAt,
    );
    return context;
  }

  async getEntries(): Promise<ConversationTreeEntry[]> {
    return (await this.tree()).entries();
  }

  private async tree() {
    const state = await this.conversations.journal.load(this.conversationId);
    if (!this.ownerAgentId) return state.modelTree;
    const existing = state.agentModelTrees.get(this.ownerAgentId);
    if (existing) return existing;
    const tree = new ConversationTreeState();
    state.agentModelTrees.set(this.ownerAgentId, tree);
    return tree;
  }
}
