import {
  type ConversationEntry,
  type ConversationRecord,
  type ConversationTree,
  type CreateConversationRequest,
  createId,
  expandTruncatedConversationTitle,
} from "@nervekit/shared";
import type { EventBus } from "../../infrastructure/events/index.js";
import type { IndexStore } from "../../infrastructure/index-store/index.js";
import type { InitializedStorage } from "../../infrastructure/storage/index.js";
import type {
  AppendEntryInput,
  AppendEntryOptions,
} from "../../runtime/types.js";
import type { RuntimeState } from "../../runtime/runtime-state.js";
import type { ConversationRepository } from "./conversation.repository.js";
import type { EntryRepository } from "./entry.repository.js";
import type { HarnessManager } from "./harness-manager.js";

export class ConversationLifecycleService {
  constructor(
    private readonly storage: InitializedStorage,
    private readonly events: EventBus,
    private readonly index: IndexStore,
    private readonly state: RuntimeState,
    private readonly conversationRepository: ConversationRepository,
    private readonly entryRepository: EntryRepository,
    private readonly harnessManager: HarnessManager,
    private readonly removeAgent: (agentId: string) => Promise<void>,
  ) {}

  async createConversation(
    request: CreateConversationRequest,
  ): Promise<ConversationRecord> {
    const project = this.state.getProject(request.projectId);
    const now = new Date().toISOString();
    const defaultSelection = this.storage.settings.rememberLastAgentSelection
      ? this.storage.settings.lastAgentSelection
      : {
          mode: this.storage.settings.defaultMode,
          permissionLevel: this.storage.settings.defaultPermissionLevel,
        };
    const conversation: ConversationRecord = {
      id: createId("conv"),
      projectId: project.id,
      title: request.title ?? "New Conversation",
      mode: request.mode ?? defaultSelection.mode,
      permissionLevel:
        request.permissionLevel ?? defaultSelection.permissionLevel,
      createdAt: now,
      updatedAt: now,
    };
    this.state.conversations.set(conversation.id, conversation);
    this.index.upsertConversation(conversation);
    this.state.entries.set(conversation.id, []);
    await this.writeConversation(conversation);
    await this.harnessManager.createConversation(conversation, project.dir);
    await this.events.publish("conversation.created", { conversation });
    return conversation;
  }

  listConversations(): ConversationRecord[] {
    return this.state.listConversations();
  }

  getConversation(conversationId: string): ConversationRecord {
    return this.state.getConversation(conversationId);
  }

  async removeConversation(conversationId: string): Promise<void> {
    const conversation = this.getConversation(conversationId);
    for (const agent of [...this.state.agents.values()].filter(
      (candidate) => candidate.conversationId === conversationId,
    )) {
      await this.removeAgent(agent.id);
    }
    this.state.conversations.delete(conversationId);
    this.state.entries.delete(conversationId);
    this.index.removeConversation(conversationId);
    await this.conversationRepository.remove(conversationId);
    await this.events.publish("conversation.deleted", {
      conversationId,
      projectId: conversation.projectId,
    });
  }

  getConversationEntries(conversationId: string): ConversationEntry[] {
    const conversation = this.getConversation(conversationId);
    return this.entryRepository.activeBranchEntries(
      this.state.entries,
      conversation,
    );
  }

  getConversationActiveEntryIds(conversationId: string): string[] {
    const conversation = this.getConversation(conversationId);
    return this.entryRepository.activeBranchEntryIds(
      this.state.entries,
      conversation,
    );
  }

  getConversationTree(conversationId: string): ConversationTree {
    const conversation = this.getConversation(conversationId);
    return this.entryRepository.getConversationTree(
      this.state.entries,
      conversation,
    );
  }

  async updateConversation(conversation: ConversationRecord): Promise<void> {
    this.state.conversations.set(conversation.id, conversation);
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
    const entries = this.state.entries.get(input.conversationId) ?? [];
    entries.push(entry);
    this.state.entries.set(input.conversationId, entries);
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
    for (const storedConversation of await this.conversationRepository.loadAll()) {
      const entries = await this.entryRepository.loadForConversation(
        storedConversation.id,
      );
      const expandedTitle = expandTruncatedConversationTitle(
        storedConversation.title,
        entries.find((entry) => entry.role === "user")?.text ?? "",
      );
      const conversation = expandedTitle
        ? { ...storedConversation, title: expandedTitle }
        : storedConversation;

      this.state.conversations.set(conversation.id, conversation);
      this.index.upsertConversation(conversation);
      this.state.entries.set(conversation.id, entries);
      if (expandedTitle) await this.writeConversation(conversation);
    }
  }

  private async writeConversation(
    conversation: ConversationRecord,
  ): Promise<void> {
    this.index.upsertConversation(conversation);
    await this.conversationRepository.write(conversation);
  }
}
