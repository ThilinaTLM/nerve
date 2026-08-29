import {
  type ConversationEntry,
  type ConversationRecord,
  type ConversationTree,
  type CreateConversationRequest,
  type UpdateConversationStateRequest,
} from "@nervekit/contracts/conversations";
import { createId } from "@nervekit/contracts";
import type { ConversationTreeEntry } from "@nervekit/harness";
import type { StreamLogRegistry } from "../../infrastructure/events/index.js";
import type { RuntimeQueryCache } from "../../infrastructure/persistence/query-cache/index.js";
import type { InitializedStorage } from "../../infrastructure/storage-bootstrap/index.js";
import { resolveProjectSettings } from "../../infrastructure/configuration/index.js";
import type { RuntimeState } from "../../app/runtime/runtime-projections.js";
import type {
  AppendEntryInput,
  AppendEntryOptions,
} from "../../app/runtime/types.js";
import type { ConversationRepository } from "./conversation.repository.js";
import type { EntryRepository } from "./entry.repository.js";
import type { ConversationHarnessStorage } from "./conversation-harness-storage.js";
import type { ToolResultPayloadStore } from "../tools/artifacts/tool-result-payload-store.js";

export class ConversationLifecycleService {
  constructor(
    private readonly storage: InitializedStorage,
    private readonly events: StreamLogRegistry,
    private readonly queryCache: RuntimeQueryCache,
    private readonly state: RuntimeState,
    private readonly conversationRepository: ConversationRepository,
    private readonly entryRepository: EntryRepository,
    private readonly harnessStorage: ConversationHarnessStorage,
    private readonly removeAgent: (agentId: string) => Promise<void>,
    private readonly resultPayloads: ToolResultPayloadStore,
  ) {}

  async createConversation(
    request: CreateConversationRequest,
  ): Promise<ConversationRecord> {
    const project = this.state.getProject(request.projectId);
    const now = new Date().toISOString();
    const effectiveSettings = await resolveProjectSettings(
      this.storage,
      project.dir,
    );
    const defaultSelection = effectiveSettings.rememberLastAgentSelection
      ? effectiveSettings.lastAgentSelection
      : {
          mode: effectiveSettings.defaultMode,
          permissionLevel: effectiveSettings.defaultPermissionLevel,
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
    this.queryCache.upsertConversation(conversation);
    this.state.setConversationEntries(conversation.id, []);
    await this.writeConversation(conversation);
    await this.harnessStorage.createConversation(conversation);
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
    this.state.removeConversation(conversationId);
    this.queryCache.removeConversation(conversationId);
    await this.conversationRepository.remove(conversationId);
    await this.events.publish("conversation.deleted", {
      conversationId,
      projectId: conversation.projectId,
    });
    await this.events.removeConversationStream(conversationId);
    await this.resultPayloads
      .removeConversation(conversationId)
      .catch(() => undefined);
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
    this.queryCache.upsertConversation(conversation);
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
    const existing = input.id
      ? this.state.getConversationEntry(input.conversationId, input.id)
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
    const committed = this.state.getConversationEntry(
      input.conversationId,
      entry.id,
    );
    if (committed) return committed;
    this.state.appendConversationEntry(entry);
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
    });
    this.state.appendConversationEntry(entry);
    this.state.conversations.set(input.conversationId, updatedConversation);
    this.queryCache.upsertConversation(updatedConversation);
    return entry;
  }

  async loadConversations(): Promise<void> {
    const storedConversations = await this.conversationRepository.loadAll();
    await Promise.all(
      storedConversations.map(async (storedConversation) => {
        const entries = await this.entryRepository.loadForConversation(
          storedConversation.id,
        );
        this.state.conversations.set(storedConversation.id, storedConversation);
        this.queryCache.upsertConversation(storedConversation);
        this.state.setConversationEntries(storedConversation.id, entries);
      }),
    );
  }

  private async writeConversation(
    conversation: ConversationRecord,
  ): Promise<void> {
    this.queryCache.upsertConversation(conversation);
    await this.conversationRepository.write(conversation);
  }
}
