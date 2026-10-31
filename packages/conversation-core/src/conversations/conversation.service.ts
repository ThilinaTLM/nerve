import {
  prepareTitleInput,
  hasMeaningfulTitleInput,
  validateGeneratedTitle,
  type ConversationTitleCapability,
} from "./ai-title.js";
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
  private readonly newTitleCandidates = new Set<string>();
  private readonly titleTokens = new Map<string, number>();
  private advanceTitleToken(id: string): number {
    const token = (this.titleTokens.get(id) ?? 0) + 1;
    this.titleTokens.set(id, token);
    return token;
  }
  constructor(
    private readonly options: {
      storage: CoreStorage;
      titles?: ConversationTitleCapability;
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
      inputs: InputQueueService;
      emit: CoreEmitter;
      now(): string;
      isExecuting(id: string): boolean;
      discard(
        ids: readonly string[],
        remove: () => Promise<void>,
      ): Promise<void>;
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
    // Clients create with the placeholder title; only a real name opts out.
    if (
      !input.parentConversationId &&
      (input.title ?? "New Conversation") === "New Conversation"
    )
      this.newTitleCandidates.add(id);
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
    if (patch.title !== undefined) {
      this.advanceTitleToken(id);
      this.newTitleCandidates.delete(id);
    }
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
    const first = messages[0];
    if (first?.type !== "user_message") return;
    const candidate = this.newTitleCandidates.delete(id);
    this.update(id, {
      title: deriveConversationTitle(first.payload.originalText),
    });
    const titles = this.options.titles;
    const setting = titles?.settings();
    if (
      !candidate ||
      messages.length !== 1 ||
      !titles ||
      !setting?.enabled ||
      !setting.model
    )
      return;
    const model = { ...setting.model };
    const text = prepareTitleInput(first.payload.originalText);
    if (!hasMeaningfulTitleInput(text)) return;
    const token = this.titleTokens.get(id);
    const controller = new AbortController();
    void titles
      .generateTitle(
        { conversationId: id, sourceMessageId: first.id, model, text },
        controller.signal,
      )
      .then((output) => {
        const title = validateGeneratedTitle(output, text);
        const current = titles.settings();
        // No awaits: guard and metadata update are one serialized JS step.
        if (
          !title ||
          !this.options.storage.conversations.get(id) ||
          this.titleTokens.get(id) !== token ||
          !current.enabled ||
          current.model?.provider !== model.provider ||
          current.model?.modelId !== model.modelId
        )
          return;
        this.advanceTitleToken(id);
        this.options.storage.conversations.update(id, { title });
        publishSummary(this.options.storage, this.options.emit, id);
      })
      .catch(() => {
        /* Background failures never affect an agent run. */
      });
  }
  async delete(id: string): Promise<void> {
    const conversation = this.options.storage.conversations.rawIdentity(id);
    if (!conversation) return;
    const ids = [
      ...new Set([id, ...this.options.storage.descendantConversationIds(id)]),
    ];
    await this.options.discard(ids, async () => {
      await this.options.assets.deleteConversationFiles(ids);
      this.options.storage.conversations.delete(id);
    });
    for (const conversationId of ids) {
      this.advanceTitleToken(conversationId);
      this.newTitleCandidates.delete(conversationId);
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
