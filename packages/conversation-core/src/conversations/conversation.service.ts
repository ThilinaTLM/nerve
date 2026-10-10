import { rm } from "node:fs/promises";
import { createId } from "@nervekit/contracts";
import {
  conversationConfigSchema,
  type ConversationConfig,
  type ConversationSnapshot,
  type UpdateConversationRequest,
} from "@nervekit/contracts/core";
import { deriveConversationTitle } from "./conversation-title.js";
import type { AssetStore } from "../assets/asset-store.js";
import type { AsyncBashService } from "../async-bash/async-bash.service.js";
import type { InputQueueService } from "../inputs/input-queue.service.js";
import type { CoreStorage } from "../storage/core-storage.js";
import type { CoreEmitter } from "../runtime/core-change.js";
import type { StatusService } from "../runtime/status.js";

export type DefaultConversationConfig = Omit<
  ConversationConfig,
  "conversationId"
>;
export interface CreateConversationInput {
  id?: string;
  projectId: string;
  parentConversationId?: string | null;
  parentToolCallId?: string | null;
  title?: string;
  config?: DefaultConversationConfig;
}
export class ConversationService {
  constructor(
    private readonly options: {
      storage: CoreStorage;
      assets: AssetStore;
      asyncBash: AsyncBashService;
      inputs: InputQueueService;
      emit: CoreEmitter;
      now(): string;
      defaultConfig(
        projectId: string,
      ): DefaultConversationConfig | Promise<DefaultConversationConfig>;
      isExecuting(id: string): boolean;
      stop(id: string): Promise<void>;
      status: StatusService;
    },
  ) {}
  async create(input: CreateConversationInput): Promise<ConversationSnapshot> {
    const { storage } = this.options;
    const id = input.id ?? createId("conv");
    const existing = storage.conversations.get(id);
    if (existing) {
      if (
        existing.projectId !== input.projectId ||
        existing.parentConversationId !==
          (input.parentConversationId ?? null) ||
        existing.parentToolCallId !== (input.parentToolCallId ?? null)
      )
        throw new Error("Conversation ID already in use");
      return this.snapshot(id);
    }
    if (!storage.projects.get(input.projectId))
      throw new Error("Project not found");
    const config = conversationConfigSchema.parse({
      ...(input.config ?? (await this.options.defaultConfig(input.projectId))),
      conversationId: id,
    });
    // The callback may await host settings; another caller can create the same ID meanwhile.
    if (storage.conversations.get(id)) return this.create(input);
    const now = this.options.now();
    storage.conversations.insert(
      {
        id,
        projectId: input.projectId,
        parentConversationId: input.parentConversationId ?? null,
        parentToolCallId: input.parentToolCallId ?? null,
        headEventId: null,
        title: input.title ?? "New Conversation",
        status: "idle",
        statusEventSequence: 0,
        statusClearedAt: null,
        paused: false,
        nextInputSequence: 1,
        pinnedAt: null,
        completedAt: null,
        lastUserMessageAt: null,
        createdAt: now,
        updatedAt: now,
      },
      config,
    );
    this.options.emit({
      kind: "conversation_changed",
      summary: storage.conversations.getSummary(id)!,
    });
    this.options.emit({ kind: "config_changed", conversationId: id, config });
    if (input.parentConversationId)
      this.emitParentSummary(input.parentConversationId);
    return this.snapshot(id);
  }
  snapshot(id: string): ConversationSnapshot {
    const storage = this.options.storage;
    const conversation = storage.conversations.get(id);
    const config = storage.conversations.getConfig(id);
    if (!conversation || !config)
      throw new Error(`Conversation not found: ${id}`);
    return {
      conversation,
      lastSequence: storage.events.lastSequence(id),
      config,
      toolCalls: storage.toolCalls.list(id),
      queue: storage.inputs.list(id),
      asyncBash: storage.asyncBash.list(id),
      children: storage.conversations.list({
        projectId: conversation.projectId,
        parentConversationId: id,
      }),
    };
  }
  update(id: string, patch: UpdateConversationRequest["patch"]): void {
    const now = this.options.now();
    this.options.storage.conversations.update(id, {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.pinned !== undefined
        ? { pinnedAt: patch.pinned ? now : null }
        : {}),
      ...(patch.completed !== undefined
        ? { completedAt: patch.completed ? now : null }
        : {}),
      ...(patch.clearStatus ? { statusClearedAt: now } : {}),
      updatedAt: now,
    });
    this.options.emit({
      kind: "conversation_changed",
      summary: this.options.storage.conversations.getSummary(id)!,
    });
    this.options.status.refresh(id);
  }
  configure(
    id: string,
    patch: Partial<DefaultConversationConfig>,
  ): ConversationConfig {
    const config = this.options.storage.conversations.getConfig(id);
    if (!config) throw new Error("Conversation not found");
    const validated = conversationConfigSchema.parse({
      ...config,
      ...patch,
      conversationId: id,
    });
    const updated = this.options.storage.conversations.updateConfig(
      id,
      validated,
    );
    this.options.emit({
      kind: "config_changed",
      conversationId: id,
      config: updated,
    });
    this.options.emit({
      kind: "conversation_changed",
      summary: this.options.storage.conversations.getSummary(id)!,
    });
    return updated;
  }
  assertQuiescent(id: string): void {
    this.snapshot(id);
    if (
      this.options.isExecuting(id) ||
      this.options.storage.toolCalls.list(id).length
    )
      throw new Error("Conversation has unfinished execution or tool calls");
  }
  selectHead(id: string, eventId: string | null): void {
    this.assertQuiescent(id);
    if (
      eventId &&
      this.options.storage.events.get(eventId)?.conversationId !== id
    )
      throw new Error("Head event belongs to another conversation");
    if (
      this.options.inputs
        .list(id)
        .some(
          (input) => input.commandPreparation && input.preparedText === null,
        )
    )
      throw new Error("Input command preparation is unfinished");
    this.options.storage.conversations.update(id, {
      headEventId: eventId,
      updatedAt: this.options.now(),
    });
    this.options.emit({
      kind: "head_changed",
      conversationId: id,
      headEventId: eventId,
    });
  }
  autoTitle(id: string): void {
    const conversation = this.options.storage.conversations.get(id);
    if (conversation?.title !== "New Conversation") return;
    const messages = this.options.storage.events
      .since(id, 0)
      .filter((event) => event.type === "user_message");
    if (messages[0]?.type === "user_message")
      this.update(id, {
        title: deriveConversationTitle(messages[0].payload.originalText),
      });
  }
  private emitParentSummary(parentId: string): void {
    const summary = this.options.storage.conversations.getSummary(parentId);
    if (summary) this.options.emit({ kind: "conversation_changed", summary });
  }
  async delete(id: string): Promise<void> {
    const conversation = this.options.storage.conversations.get(id);
    if (!conversation) return;
    const ids = [id, ...this.options.storage.descendantConversationIds(id)];
    await this.options.stop(id);
    await this.options.asyncBash.cancelForConversations(ids);
    for (const conversationId of ids)
      for (const input of this.options.inputs.list(conversationId))
        this.options.inputs.cancel(input.inputId);
    await this.options.assets.deleteConversations(ids);
    for (const conversationId of ids)
      await rm(this.options.assets.path(`conversations/${conversationId}`), {
        recursive: true,
        force: true,
      });
    this.options.storage.conversations.delete(id);
    for (const conversationId of ids)
      this.options.emit({ kind: "conversation_deleted", conversationId });
    if (conversation.parentConversationId)
      this.emitParentSummary(conversation.parentConversationId);
  }
}
