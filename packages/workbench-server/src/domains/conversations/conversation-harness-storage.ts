import { validateModelHistoryPath } from "./model-history-navigation.js";
import {
  applyPromptCompactionAnchor,
  withPromptCompactionAnchor,
  type PromptAnchor,
} from "./compaction-provenance.js";
import { isDeepStrictEqual } from "node:util";
import {
  resolveCompactionOwner,
  compactionOwnerKey,
} from "./compaction-owner.js";
import { randomUUID } from "node:crypto";
import type { PerformanceDiagnosticsPort } from "../../core/ports/diagnostics.js";
import { noopPerformanceDiagnostics } from "../../infrastructure/diagnostics/performance-metrics.js";
import type { Message } from "@earendil-works/pi-ai";
import { type AgentMessage } from "@nervekit/harness/agent";
import {
  Conversation,
  ConversationTreeState,
  type ConversationMetadata,
  type ConversationStorage,
  type ConversationTreeEntry,
} from "@nervekit/harness/conversation";
import type { AgentRecord } from "@nervekit/contracts/agents";
import type {
  ConversationEntry,
  ConversationRecord,
} from "@nervekit/contracts/conversations";
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
      resolveCompactionOwner(conversation.id, agent).ownerAgentId,
      this.diagnostics,
    );
  }

  async createConversation(conversation: ConversationRecord): Promise<void> {
    await this.openStorage(conversation);
  }

  async appendAgentMessage(
    agent: AgentRecord,
    message: AgentMessage,
    anchor?: PromptAnchor,
  ): Promise<{ id: string; timestamp: string }> {
    const conversation = this.getConversation(agent.conversationId);
    const storage =
      resolveCompactionOwner(conversation.id, agent).ownerAgentId !== undefined
        ? await this.openAgentStorage(agent)
        : await this.openStorage(conversation);
    const harnessConversation = new Conversation(storage);
    const append = () => harnessConversation.appendMessage(message);
    const id = await (anchor
      ? withPromptCompactionAnchor(agent, anchor, append)
      : append());
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
    anchor?: PromptAnchor,
  ): Promise<{ id: string; timestamp: string }> {
    const conversation = this.getConversation(agent.conversationId);
    const storage =
      resolveCompactionOwner(conversation.id, agent).ownerAgentId !== undefined
        ? await this.openAgentStorage(agent)
        : await this.openStorage(conversation);
    const existing = await storage.getEntry(id);
    if (existing) {
      if (
        existing.type !== "message" ||
        !isDeepStrictEqual(
          { ...existing.message, timestamp: undefined },
          { ...message, timestamp: undefined },
        )
      )
        throw new Error("Stable message ID conflicts with existing entry.");
      return { id, timestamp: existing.timestamp };
    }
    const harnessConversation = new Conversation(storage);
    const append = () =>
      harnessConversation.appendMessageWithId(id, message, timestamp);
    await (anchor
      ? withPromptCompactionAnchor(agent, anchor, append)
      : append());
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
    const storage =
      resolveCompactionOwner(conversation.id, agent).ownerAgentId !== undefined
        ? await this.openAgentStorage(agent)
        : await this.openStorage(conversation);
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

  async getConversationEntry(
    conversationId: string,
    entryId: string,
  ): Promise<ConversationEntry | undefined> {
    return (
      await this.conversationRepository.journal.load(conversationId)
    ).entryById.get(entryId);
  }

  registerQueuedPromptAnchor(
    conversation: Conversation,
    id: string,
    anchor?: PromptAnchor,
  ): void {
    const storage = conversation.getStorage();
    if (!(storage instanceof JournalConversationStorage))
      throw new Error("Queued prompt provenance requires journal storage.");
    storage.registerCompactionAnchor(id, anchor);
  }

  async pendingProviderToolCallIds(
    conversationId: string,
    ownerAgentId: string | undefined,
    getAgent: (agentId: string) => AgentRecord,
  ): Promise<string[]> {
    return this.conversationRepository.journal.pendingProviderToolCallIds(
      conversationId,
      (agentId) =>
        resolveCompactionOwner(conversationId, getAgent(agentId))
          .ownerAgentId === ownerAgentId,
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
  private readonly queuedPromptAnchors = new Map<string, PromptAnchor>();

  registerCompactionAnchor(id: string, anchor?: PromptAnchor): void {
    if (anchor) this.queuedPromptAnchors.set(id, anchor);
    else this.queuedPromptAnchors.delete(id);
  }
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
    const queuedAnchor = this.queuedPromptAnchors.get(entry.id);
    entry = applyPromptCompactionAnchor(
      entry,
      compactionOwnerKey(this.conversationId, this.ownerAgentId),
    );
    if (
      queuedAnchor &&
      entry.type === "message" &&
      entry.message.role === "user"
    ) {
      entry = { ...entry, compactionAnchor: queuedAnchor };
      this.queuedPromptAnchors.delete(entry.id);
    }
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
    const tree = await this.tree();
    return validateModelHistoryPath(
      new Map(tree.entries().map((entry) => [entry.id, entry])),
      leafId,
    );
  }

  async getContextPath(leafId?: string | null) {
    const tree = await this.tree();
    const selected = leafId === undefined ? await this.getLeafId() : leafId;
    validateModelHistoryPath(
      new Map(tree.entries().map((entry) => [entry.id, entry])),
      selected,
    );
    return tree.getContextPath(selected);
  }

  async buildContext(leafId?: string | null) {
    const startedAt = performance.now();
    const tree = await this.tree();
    const selected = leafId === undefined ? await this.getLeafId() : leafId;
    validateModelHistoryPath(
      new Map(tree.entries().map((entry) => [entry.id, entry])),
      selected,
    );
    const context = tree.buildContext(selected);
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
