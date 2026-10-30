import { publishSummary } from "../runtime/publish-summary.js";
import type {
  LeadSettingsOverrides,
  ProfileTarget,
} from "@nervekit/contracts/agent-configuration";
import type {
  ConversationContext,
  AgentConfigurationPort,
} from "../configuration.js";
import { configureConversationRequestSchema } from "@nervekit/contracts/core";
import type { SubagentHost } from "../delegation/subagent-host.js";
import { rm } from "node:fs/promises";
import { createId } from "@nervekit/contracts";
import {
  conversationConfigSchema,
  type ConversationHistoryConfig,
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
import type { CompactionOperations } from "../runtime/compaction-operations.js";
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
  config?: Partial<ConversationContext>;
  overrides?: LeadSettingsOverrides;
  agentProfile?: ProfileTarget;
  application?: Awaited<
    ReturnType<SubagentHost["resolveProfile"]>
  >["application"];
}
export class ConversationService {
  constructor(
    private readonly options: {
      storage: CoreStorage;
      summary?(
        id: string,
      ): Partial<
        Pick<
          ConversationConfig,
          "model" | "reasoningLevel" | "permissionRuleSetId" | "agentProfile"
        >
      >;
      historyContext?: AgentConfigurationPort["historyContext"];
      configureContext: AgentConfigurationPort["configureContext"];
      assets: AssetStore;
      asyncBash: AsyncBashService;
      inputs: InputQueueService;
      emit: CoreEmitter;
      now(): string;
      isExecuting(id: string): boolean;
      stop(id: string): Promise<void>;
      status: StatusService;
      compactions: CompactionOperations;
    },
  ) {}
  async create(
    input: CreateConversationInput,
    initialConfig?: DefaultConversationConfig,
  ): Promise<ConversationSnapshot> {
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
      ...initialConfig,
      ...input.config,
      conversationId: id,
    });
    // The callback may await host settings; another caller can create the same ID meanwhile.
    if (storage.conversations.get(id)) return this.create(input, initialConfig);
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
    publishSummary(storage, this.options.emit, id);
    this.options.emit({
      kind: "config_changed",
      conversationId: id,
      config: { ...config, ...this.options.summary?.(id) },
    });
    return this.snapshot(id);
  }
  snapshot(id: string): ConversationSnapshot {
    const storage = this.options.storage;
    const conversation = storage.conversations.get(id);
    const config = storage.conversations.getContext(id);
    if (!conversation || !config)
      throw new Error(`Conversation not found: ${id}`);
    return {
      conversation,
      compaction: this.options.compactions.get(id),
      lastSequence: storage.events.lastSequence(id),
      config: { ...config, ...this.options.historyContext?.(id) },
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
    this.options.status.refresh(id, false);
    publishSummary(this.options.storage, this.options.emit, id);
  }
  async configure(
    id: string,
    patch: Partial<ConversationContext>,
  ): Promise<ConversationHistoryConfig> {
    const validated =
      configureConversationRequestSchema.shape.patch.parse(patch);
    if (!this.options.storage.conversations.getContext(id))
      throw new Error("Conversation not found");
    const context = {
      ...(validated.instructions !== undefined
        ? { instructions: validated.instructions }
        : {}),
      ...(validated.systemPrompt !== undefined
        ? { systemPrompt: validated.systemPrompt }
        : {}),
    };
    if (Object.keys(context).length)
      await this.options.configureContext(id, context);
    const updated = this.options.storage.conversations.updateConfig(
      id,
      validated.workingDirectory !== undefined
        ? { workingDirectory: validated.workingDirectory }
        : {},
    );
    const config = { ...updated, ...this.options.historyContext?.(id) };
    this.options.emit({
      kind: "config_changed",
      conversationId: id,
      config,
    });
    publishSummary(this.options.storage, this.options.emit, id);
    return config;
  }
  assertQuiescent(id: string): void {
    this.snapshot(id);
    this.options.compactions.assertIdle(id);
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
    for (const conversationId of ids) {
      this.options.compactions.delete(conversationId);
      this.options.emit({ kind: "conversation_deleted", conversationId });
    }
    if (conversation.parentConversationId)
      publishSummary(
        this.options.storage,
        this.options.emit,
        conversation.parentConversationId,
      );
  }
}
