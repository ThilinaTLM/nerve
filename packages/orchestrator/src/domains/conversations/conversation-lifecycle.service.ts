import {
  type ConversationEntry,
  type ConversationRecord,
  type ConversationTree,
  type CreateConversationRequest,
  createId,
  type ProjectRecord,
} from "@nerve/shared";
import type { HarnessManager } from "../../harness-manager.js";
import { HttpError } from "../../http/errors.js";
import type { EventBus } from "../../infrastructure/events/index.js";
import type { IndexStore } from "../../infrastructure/index-store/index.js";
import type { InitializedStorage } from "../../infrastructure/storage/index.js";
import type {
  AppendEntryInput,
  AppendEntryOptions,
} from "../../registry/types.js";
import type { ConversationRepository } from "./conversation.repository.js";
import type { EntryRepository } from "./entry.repository.js";

export class ConversationLifecycleService {
  constructor(
    private readonly storage: InitializedStorage,
    private readonly events: EventBus,
    private readonly index: IndexStore,
    private readonly conversations: Map<string, ConversationRecord>,
    private readonly entries: Map<string, ConversationEntry[]>,
    private readonly conversationRepository: ConversationRepository,
    private readonly entryRepository: EntryRepository,
    private readonly harnessManager: HarnessManager,
    private readonly getProject: (projectId: string) => ProjectRecord,
    private readonly removeAgent: (agentId: string) => Promise<void>,
    private readonly agentsForConversation: (
      conversationId: string,
    ) => { id: string }[],
  ) {}

  async createConversation(
    request: CreateConversationRequest,
  ): Promise<ConversationRecord> {
    const project = this.getProject(request.projectId);
    const now = new Date().toISOString();
    const conversation: ConversationRecord = {
      id: createId("conv"),
      projectId: project.id,
      title: request.title ?? "New Conversation",
      mode: request.mode ?? this.storage.settings.defaultMode,
      permissionLevel:
        request.permissionLevel ?? this.storage.settings.defaultPermissionLevel,
      createdAt: now,
      updatedAt: now,
    };
    this.conversations.set(conversation.id, conversation);
    this.index.upsertConversation(conversation);
    this.entries.set(conversation.id, []);
    await this.writeConversation(conversation);
    await this.harnessManager.createConversation(conversation, project.dir);
    await this.events.publish("conversation.created", { conversation });
    return conversation;
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

  async removeConversation(conversationId: string): Promise<void> {
    const conversation = this.getConversation(conversationId);
    for (const agent of this.agentsForConversation(conversationId)) {
      await this.removeAgent(agent.id);
    }
    this.conversations.delete(conversationId);
    this.entries.delete(conversationId);
    this.index.removeConversation(conversationId);
    await this.conversationRepository.remove(conversationId);
    await this.events.publish("conversation.deleted", {
      conversationId,
      projectId: conversation.projectId,
    });
  }

  getConversationEntries(conversationId: string): ConversationEntry[] {
    const conversation = this.getConversation(conversationId);
    return this.entryRepository.activeBranchEntries(this.entries, conversation);
  }

  getConversationActiveEntryIds(conversationId: string): string[] {
    const conversation = this.getConversation(conversationId);
    return this.entryRepository.activeBranchEntryIds(
      this.entries,
      conversation,
    );
  }

  getConversationTree(conversationId: string): ConversationTree {
    const conversation = this.getConversation(conversationId);
    return this.entryRepository.getConversationTree(this.entries, conversation);
  }

  async updateConversation(conversation: ConversationRecord): Promise<void> {
    this.conversations.set(conversation.id, conversation);
    this.index.upsertConversation(conversation);
    await this.writeConversation(conversation);
  }

  async appendEntry(
    input: AppendEntryInput,
    options: AppendEntryOptions = {},
  ): Promise<ConversationEntry> {
    const conversation = this.getConversation(input.conversationId);
    const entry: ConversationEntry = {
      id: input.id ?? createId("entry"),
      conversationId: input.conversationId,
      agentId: input.agentId,
      runId: input.runId,
      turnId: input.turnId,
      liveMessageId: input.liveMessageId,
      parentEntryId:
        "parentEntryId" in input
          ? (input.parentEntryId ?? undefined)
          : conversation.activeEntryId,
      role: input.role,
      kind: input.kind ?? "message",
      text: input.text,
      summary: input.summary,
      tokensBefore: input.tokensBefore,
      usage: input.usage,
      firstKeptEntryId: input.firstKeptEntryId,
      fromEntryId: input.fromEntryId,
      details: input.details,
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    const entries = this.entries.get(input.conversationId) ?? [];
    entries.push(entry);
    this.entries.set(input.conversationId, entries);
    await this.entryRepository.append(entry);
    await this.updateConversation({
      ...conversation,
      activeEntryId: entry.id,
      updatedAt: entry.createdAt,
    });
    if (options.mirrorToHarness !== false)
      await this.harnessManager.appendEntry(entry);
    return entry;
  }

  async loadConversations(): Promise<void> {
    for (const conversation of await this.conversationRepository.loadAll()) {
      this.conversations.set(conversation.id, conversation);
      this.index.upsertConversation(conversation);
      this.entries.set(
        conversation.id,
        await this.entryRepository.loadForConversation(conversation.id),
      );
    }
  }

  private async writeConversation(
    conversation: ConversationRecord,
  ): Promise<void> {
    this.index.upsertConversation(conversation);
    await this.conversationRepository.write(conversation);
  }
}
