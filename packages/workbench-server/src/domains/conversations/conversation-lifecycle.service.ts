import {
  type ConversationEntry,
  type ConversationRecord,
  type ConversationTree,
  type CreateConversationRequest,
  type UpdateConversationStateRequest,
  createId,
  expandTruncatedConversationTitle,
} from "@nervekit/contracts";
import type { ConversationTreeEntry } from "@nervekit/harness";
import type { StreamLogRegistry } from "../../infrastructure/events/index.js";
import type { RuntimeProjectionStore } from "../../infrastructure/runtime-projection-store/index.js";
import type { InitializedStorage } from "../../infrastructure/storage/index.js";
import type { RuntimeState } from "../../runtime/runtime-state.js";
import type {
  AppendEntryInput,
  AppendEntryOptions,
} from "../../runtime/types.js";
import type { ConversationRepository } from "./conversation.repository.js";
import type { EntryRepository } from "./entry.repository.js";
import type { ConversationHarnessStorage } from "./conversation-harness-storage.js";

export class ConversationLifecycleService {
  constructor(
    private readonly storage: InitializedStorage,
    private readonly events: StreamLogRegistry,
    private readonly index: RuntimeProjectionStore,
    private readonly state: RuntimeState,
    private readonly conversationRepository: ConversationRepository,
    private readonly entryRepository: EntryRepository,
    private readonly harnessStorage: ConversationHarnessStorage,
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
    await this.harnessStorage.createConversation(conversation, project.dir);
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
    await this.events.removeConversationStream(conversationId);
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
    await this.events.publish("conversation.updated", { conversation });
  }

  async updateConversationState(
    conversationId: string,
    request: UpdateConversationStateRequest,
  ): Promise<ConversationRecord> {
    const conversation = this.getConversation(conversationId);
    const now = new Date().toISOString();
    const updated: ConversationRecord = {
      ...conversation,
      ...(request.pinned !== undefined ? { pinned: request.pinned } : {}),
      ...(request.completed === true ? { completedAt: now } : {}),
      ...(request.clearRuntimeStatus === true
        ? { runtimeStatusClearedAt: now }
        : {}),
    };
    if (request.completed === false) delete updated.completedAt;
    await this.updateConversation(updated);
    return updated;
  }

  async appendEntry(
    input: AppendEntryInput,
    options: AppendEntryOptions = {},
  ): Promise<ConversationEntry> {
    const conversation = this.getConversation(input.conversationId);
    const entries = this.state.entries.get(input.conversationId) ?? [];
    const existing = input.id
      ? entries.find((candidate) => candidate.id === input.id)
      : undefined;
    if (existing) return existing;

    let entry: ConversationEntry = {
      id: input.id ?? createId("entry"),
      conversationId: input.conversationId,
      agentId: input.agentId,
      runId: input.runId,
      turnId: input.turnId,
      liveMessageId: input.liveMessageId,
      messageOrdinal: input.messageOrdinal,
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
    entry = await this.entryRepository.append(entry);
    const committed = entries.find((candidate) => candidate.id === entry.id);
    if (committed) return committed;
    entries.push(entry);
    this.state.entries.set(input.conversationId, entries);
    const lastUserMessageAt =
      entry.role === "user" &&
      (!conversation.lastUserMessageAt ||
        entry.createdAt > conversation.lastUserMessageAt)
        ? entry.createdAt
        : conversation.lastUserMessageAt;
    const updatedConversation: ConversationRecord = {
      ...conversation,
      activeEntryId: entry.id,
      updatedAt: entry.createdAt,
      lastUserMessageAt,
    };
    if (entry.role === "user") delete updatedConversation.completedAt;
    await this.updateConversation(updatedConversation);
    if (options.mirrorToHarness !== false)
      await this.harnessStorage.appendEntry(entry);
    return entry;
  }

  async appendCompactionAtomic(
    input: AppendEntryInput & { id: string; createdAt: string },
    modelEntry: ConversationTreeEntry,
  ): Promise<ConversationEntry> {
    const conversation = this.getConversation(input.conversationId);
    const entry: ConversationEntry = {
      id: input.id,
      conversationId: input.conversationId,
      agentId: input.agentId,
      runId: input.runId,
      parentEntryId: input.parentEntryId ?? conversation.activeEntryId,
      role: input.role,
      kind: input.kind ?? "compaction",
      text: input.text,
      summary: input.summary,
      tokensBefore: input.tokensBefore,
      firstKeptEntryId: input.firstKeptEntryId,
      details: input.details,
      createdAt: input.createdAt,
    };
    const updatedConversation: ConversationRecord = {
      ...conversation,
      activeEntryId: entry.id,
      updatedAt: entry.createdAt,
    };
    await this.entryRepository.appendCompaction({
      entry,
      modelEntry,
      conversation: updatedConversation,
      agentId: input.agentId,
    });
    const entries = this.state.entries.get(input.conversationId) ?? [];
    entries.push(entry);
    this.state.entries.set(input.conversationId, entries);
    this.state.conversations.set(input.conversationId, updatedConversation);
    this.index.upsertConversation(updatedConversation);
    return entry;
  }

  async loadConversations(): Promise<void> {
    const storedConversations = await this.conversationRepository.loadAll();
    await Promise.all(
      storedConversations.map(async (storedConversation) => {
        const entries = await this.entryRepository.loadForConversation(
          storedConversation.id,
        );
        const expandedTitle = expandTruncatedConversationTitle(
          storedConversation.title,
          entries.find((entry) => entry.role === "user")?.text ?? "",
        );
        const lastUserMessageAt = latestUserEntryCreatedAt(entries);
        const conversation: ConversationRecord = {
          ...storedConversation,
          ...(expandedTitle ? { title: expandedTitle } : {}),
          ...(lastUserMessageAt ? { lastUserMessageAt } : {}),
        };
        const shouldWrite =
          Boolean(expandedTitle) ||
          storedConversation.lastUserMessageAt !==
            conversation.lastUserMessageAt;

        this.state.conversations.set(conversation.id, conversation);
        this.index.upsertConversation(conversation);
        this.state.entries.set(conversation.id, entries);
        if (shouldWrite) await this.writeConversation(conversation);
      }),
    );
  }

  private async writeConversation(
    conversation: ConversationRecord,
  ): Promise<void> {
    this.index.upsertConversation(conversation);
    await this.conversationRepository.write(conversation);
  }
}

function latestUserEntryCreatedAt(
  entries: ConversationEntry[],
): string | undefined {
  return entries
    .filter((entry) => entry.role === "user")
    .map((entry) => entry.createdAt)
    .sort((a, b) => b.localeCompare(a))[0];
}
