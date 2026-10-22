import type { CapabilityOverridesDocument } from "@nervekit/contracts/capabilities";
import {
  appliedAgentProfileSchema,
  assertAppliedProfileConfigChange,
} from "@nervekit/contracts/agent-profiles";
import { conversationConfigSchema } from "@nervekit/contracts/core";
import { storedToolResultSchema } from "@nervekit/contracts/core";
import type { TransferredConversationEvent } from "@nervekit/contracts/core";
import { submitInputRequestSchema } from "@nervekit/contracts/core";
import { parseInlineCommandPrompt } from "@nervekit/contracts/completions";
import type {
  PreviewSystemPromptParams,
  QueuedInput,
  ToolCall,
  ConversationSnapshot,
  ConversationConfig,
  ListConversationsRequest,
  ResolveInteractionRequest,
  SubmitInputRequest,
  UpdateConversationRequest,
} from "@nervekit/contracts/core";
import { type AutoCompactionSettings } from "@nervekit/contracts/settings";
import { loadProjectionOptions } from "./context/asset-projection.js";
import { estimatePathUsage } from "./context/context-usage.js";
import { AssetStore } from "./assets/asset-store.js";
import { AsyncBashService } from "./async-bash/async-bash.service.js";
import {
  ConversationService,
  type CreateConversationInput,
  type DefaultConversationConfig,
} from "./conversations/conversation.service.js";
import { ProjectService } from "./conversations/project.service.js";
import { TrustedResourceService } from "./conversations/trusted-resource.service.js";
import { InputQueueService } from "./inputs/input-queue.service.js";
import type {
  AgentProfilePort,
  AgentProfileApplication,
  TurnPreparationInput,
  ClockPort,
  ModelPort,
  PermissionPort,
  ProcessPort,
  ToolHostPort,
  TurnResourcesPort,
} from "./ports.js";
import type { CoreStorage } from "./storage/core-storage.js";
import { ToolCallService } from "./tool-calls/tool-call.service.js";
import {
  createCoreToolHandlers,
  type CoreToolHandlerOptions,
} from "./tool-calls/core-tool-handlers.js";
import type { CoreToolHandler } from "./tool-calls/core-tool.js";
import type { CoreChange } from "./runtime/core-change.js";
import {
  ConversationRunner,
  type ExecutionFinished,
} from "./runtime/conversation-runner.js";
import { ModelTurn } from "./runtime/model-turn.js";
import { recoverCore } from "./runtime/recovery.js";
import { CompactionOperations } from "./runtime/compaction-operations.js";
import { ConversationScheduler } from "./runtime/scheduler.js";
import { openExecutionId, StatusService } from "./runtime/status.js";

export interface ConversationCoreOptions {
  agentProfiles: AgentProfilePort;
  storage: CoreStorage;
  dataDir: string;
  models: ModelPort;
  turnResources: TurnResourcesPort;
  permissions: PermissionPort;
  toolHost: ToolHostPort;
  processes: ProcessPort;
  clock?: ClockPort;
  defaultConfig(
    projectId: string,
  ): DefaultConversationConfig | Promise<DefaultConversationConfig>;
  /**
   * Awaited after durable project removal. Rejection does not roll back deletion;
   * handle recoverable cleanup failures inside the callback.
   */
  onProjectDeleted?(projectId: string): void | Promise<void>;
  coreTools?: Iterable<CoreToolHandler>;
  readPlan?: CoreToolHandlerOptions["readPlan"];
  planApprovalProfile?: CoreToolHandlerOptions["planApprovalProfile"];
  /** Effective auto-compaction settings (user, project, conversation); built-in defaults when absent. */
  compactionSettings?(
    conversationId: string,
  ): AutoCompactionSettings | Promise<AutoCompactionSettings>;
}
export interface ContextUsage {
  tokens: number;
  /** Model context window; 0 when the model cannot be resolved. */
  window: number;
  /** Rounded usage percentage, or null when the window is unknown. */
  percent: number | null;
}
export class ConversationCore {
  readonly projects: ProjectService;
  readonly trust: TrustedResourceService;
  readonly conversations: ConversationService;
  readonly inputs: InputQueueService;
  readonly toolCalls: ToolCallService;
  readonly asyncBash: AsyncBashService;
  readonly assets: AssetStore;
  readonly dataDir: string;
  private readonly listeners = new Set<(change: CoreChange) => void>();
  private readonly finishedListeners = new Set<
    (result: ExecutionFinished) => void
  >();
  private readonly coreTools = new Map<string, CoreToolHandler>();
  private readonly compactions: CompactionOperations;
  private readonly scheduler: ConversationScheduler;
  private readonly runner: ConversationRunner;
  private readonly modelTurn: ModelTurn;
  private readonly status: StatusService;
  private readonly creations = new Map<string, Promise<ConversationSnapshot>>();
  private readonly profileApplications = new Map<
    string,
    Promise<ConversationConfig>
  >();
  private starting?: Promise<void>;
  private closing?: Promise<void>;
  constructor(private readonly options: ConversationCoreOptions) {
    this.dataDir = options.dataDir;
    const now = () => options.clock?.now() ?? new Date().toISOString();
    const publish = (change: CoreChange) => {
      for (const listener of this.listeners) {
        // A host observer must not roll back core work or break a model stream.
        try {
          listener(change);
        } catch {
          /* Observers own their error reporting. */
        }
      }
    };
    this.status = new StatusService(
      options.storage,
      publish,
      now,
      (result) => {
        for (const listener of this.finishedListeners) {
          try {
            listener(result);
          } catch {
            /* Observers own their error reporting. */
          }
        }
      },
      (id) => this.scheduler?.isProcessing(id) ?? false,
    );
    const emit = (change: CoreChange) => {
      if (
        change.kind === "event_appended" ||
        change.kind === "tool_call_changed"
      )
        this.status.refresh(change.conversationId);
      if (
        change.kind === "event_appended" &&
        change.event.type === "user_message"
      )
        this.conversations?.autoTitle(change.conversationId);
      if (
        change.kind === "tool_call_changed" &&
        !("removed" in change.toolCall) &&
        (change.toolCall.state === "awaiting_input" ||
          change.toolCall.state === "awaiting_approval")
      ) {
        const executionId = openExecutionId(
          options.storage,
          change.conversationId,
        );
        if (executionId)
          this.status.transition(change.conversationId, {
            subtype: "execution_state",
            transition: "waiting",
            executionId,
            waiting: { toolCallId: change.toolCall.id },
          });
      }
      publish(change);
      if (change.kind === "tool_call_changed" && "removed" in change.toolCall)
        queueMicrotask(() => this.scheduler?.wake(change.conversationId));
    };
    this.compactions = new CompactionOperations(emit, now);
    this.assets = new AssetStore(options.dataDir, options.storage);
    this.inputs = new InputQueueService({
      storage: options.storage,
      processes: options.processes,
      emit,
      requestWake: (id) => this.scheduler?.wake(id),
    });
    this.asyncBash = new AsyncBashService({
      storage: options.storage,
      assets: this.assets,
      processes: options.processes,
      inputs: this.inputs,
      emit,
    });
    this.toolCalls = new ToolCallService({
      storage: options.storage,
      assets: this.assets,
      permissions: options.permissions,
      host: options.toolHost,
      emit,
      onSettled: (id) => this.status.refresh(id),
      coreTools: this.coreTools,
      asyncBash: this.asyncBash,
      context: async (id) => {
        const conversation = options.storage.conversations.get(id);
        const config = options.storage.conversations.getConfig(id);
        const project =
          conversation && options.storage.projects.get(conversation.projectId);
        if (!project || !config)
          throw new Error("Conversation context not found");
        return { projectDir: project.directory, config };
      },
    });
    this.modelTurn = new ModelTurn(
      options.models,
      options.turnResources,
      () => [...this.coreTools.values()].map((handler) => handler.definition),
      emit,
      this.assets,
      options.agentProfiles,
    );
    this.runner = new ConversationRunner({
      assets: this.assets,
      storage: options.storage,
      inputs: this.inputs,
      toolCalls: this.toolCalls,
      models: options.models,
      modelTurn: this.modelTurn,
      status: this.status,
      emit,
      now,
      compactionSettings: options.compactionSettings,
      compactions: this.compactions,
    });
    this.scheduler = new ConversationScheduler({
      storage: options.storage,
      inputs: this.inputs,
      toolCalls: this.toolCalls,
      asyncBash: this.asyncBash,
      runner: this.runner,
      compactions: this.compactions,
      status: this.status,
      emit,
    });
    this.conversations = new ConversationService({
      storage: options.storage,
      assets: this.assets,
      asyncBash: this.asyncBash,
      inputs: this.inputs,
      emit,
      now,
      defaultConfig: options.defaultConfig,
      compactions: this.compactions,
      isExecuting: (id) => this.scheduler.isExecuting(id),
      stop: (id) => this.scheduler.stop(id),
      status: this.status,
      agentProfiles: options.agentProfiles,
    });
    this.projects = new ProjectService(
      options.storage,
      (id) => this.delete(id),
      now,
      options.onProjectDeleted,
    );
    this.trust = new TrustedResourceService(options.storage, now);
    for (const handler of createCoreToolHandlers({
      assets: this.assets,
      setAgentProfile: (id, profile, overrides) =>
        this.setAgentProfile(id, profile, {
          preserveModel: true,
          preserveThinking: true,
          overrides,
        }),
      readPlan: options.readPlan,
      planApprovalProfile: options.planApprovalProfile,
      onPlanRejected: (id) => this.scheduler.pause(id),
    }).values())
      this.registerCoreTool(handler);
    for (const handler of options.coreTools ?? [])
      this.registerCoreTool(handler);
  }
  registerCoreTool(handler: CoreToolHandler): void {
    this.coreTools.set(handler.definition.name, handler);
  }
  createConversation(
    input: CreateConversationInput,
  ): Promise<ConversationSnapshot> {
    const pending = input.id && this.creations.get(input.id);
    if (pending) return pending.then(() => this.conversations.create(input));
    const creating = this.createAndApplyProfile(input);
    if (input.id) {
      const id = input.id;
      this.creations.set(id, creating);
      const finished = () => {
        if (this.creations.get(id) === creating) this.creations.delete(id);
      };
      void creating.then(finished, finished);
    }
    return creating;
  }
  private async createAndApplyProfile(
    input: CreateConversationInput,
  ): Promise<ConversationSnapshot> {
    if (input.application && input.capabilityOverrides)
      throw new Error(
        "Initial capabilities must be resolved before supplying a profile application",
      );
    const existing =
      input.id && this.options.storage.conversations.get(input.id);
    if (!existing && input.parentConversationId && !input.application)
      throw new Error(
        "Sub-agent creation requires a resolved profile application",
      );
    const created = await this.conversations.create(
      input.parentConversationId && !input.config
        ? {
            ...input,
            config: {
              ...(await this.options.defaultConfig(input.projectId)),
              systemPrompt: null,
              instructions: null,
            },
          }
        : input,
    );
    if (existing) return created;
    try {
      if (input.application)
        await this.applyProfileApplication(
          created.conversation.id,
          input.application,
        );
      else
        await this.setAgentProfile(
          created.conversation.id,
          created.config.agentProfile,
          { capabilityOverrides: input.capabilityOverrides },
        );
    } catch (error) {
      await this.delete(created.conversation.id);
      throw error;
    }
    return this.getSnapshot(created.conversation.id);
  }
  listConversations(input: ListConversationsRequest) {
    return this.options.storage.conversations.list(input);
  }
  getSnapshot(id: string): ConversationSnapshot {
    return this.conversations.snapshot(id);
  }
  getUsage(id: string) {
    return this.options.storage.events.getUsage(id);
  }
  getHistory(
    id: string,
    page: { beforeEventId?: string; limit: number },
  ): TransferredConversationEvent[] {
    return this.options.storage.events.historyPage(id, page);
  }
  getEventsSince(id: string, sequence: number): TransferredConversationEvent[] {
    return this.options.storage.events.sincePage(id, sequence);
  }
  async getToolCallDetails(conversationId: string, toolCallId: string) {
    const event = this.options.storage.events.toolResponse(
      conversationId,
      toolCallId,
    );
    if (!event) throw new Error("Tool call response not found in conversation");
    const payload = this.options.storage.assets
      .list(conversationId)
      .find(
        (asset) =>
          asset.toolCallId === toolCallId &&
          asset.logicalPath.endsWith("/result.json"),
      );
    if (!payload) throw new Error("Complete tool result asset not found");
    const result = storedToolResultSchema.parse(
      JSON.parse((await this.assets.read(payload.id)).toString("utf8")),
    );
    for (const block of result.contentBlocks ?? []) {
      if (block.type !== "image") continue;
      const image = this.options.storage.assets.get(block.assetId);
      if (
        image?.conversationId !== conversationId ||
        image.toolCallId !== toolCallId
      )
        throw new Error("Image asset does not belong to tool call");
      block.byteLength = image.byteLength;
    }
    return { agentProjection: event.payload.agentProjection, result };
  }
  /** Arguments of a model tool call: the open row, or its recorded response. */
  toolCallArguments(
    conversationId: string,
    toolCallId: string,
  ): Record<string, unknown> | null {
    const open = this.options.storage.toolCalls.get(toolCallId);
    if (open?.conversationId === conversationId) return open.arguments;
    return (
      this.options.storage.events.toolResponse(conversationId, toolCallId)
        ?.payload.arguments ?? null
    );
  }
  /** Snapshot of the next request's current system prompt; does not run a model. */
  async previewSystemPrompt(input: PreviewSystemPromptParams): Promise<string> {
    const { storage } = this.options;
    const saved = "conversationId" in input;
    const conversation = saved
      ? storage.conversations.get(input.conversationId)
      : { projectId: input.projectId, parentConversationId: null };
    const config = saved
      ? storage.conversations.getConfig(input.conversationId)
      : input.config;
    if (!conversation || !config) throw new Error("Conversation not found");
    const project = storage.projects.get(conversation.projectId);
    if (!project) throw new Error("Project not found");
    const prepared = await this.modelTurn.prepare({
      conversation,
      config,
      projectDir: project.directory,
      ...(!saved
        ? {
            capabilityOverrides: input.capabilityOverrides,
            agentProfileOverrides: input.agentProfileOverrides,
          }
        : {}),
    });
    return prepared.systemPrompt;
  }
  async contextUsage(id: string): Promise<ContextUsage> {
    const config = this.options.storage.conversations.getConfig(id);
    if (!config) throw new Error("Conversation not found");
    const path = this.runner.path(id);
    const projection = await loadProjectionOptions(path, this.assets);
    const tokens = Math.round(estimatePathUsage(path, projection).tokens);
    const window = await this.options.models
      .resolve(config.model)
      .then(({ model }) => model.contextWindow)
      .catch(() => 0);
    return {
      tokens,
      window,
      percent: window > 0 ? Math.round((tokens / window) * 100) : null,
    };
  }
  getTree(id: string) {
    return this.options.storage.events.treeNodes(id);
  }
  update(id: string, patch: UpdateConversationRequest["patch"]) {
    this.conversations.update(id, patch);
  }
  private profileInput(id: string): TurnPreparationInput {
    const conversation = this.options.storage.conversations.get(id);
    const config = this.options.storage.conversations.getConfig(id);
    const project =
      conversation && this.options.storage.projects.get(conversation.projectId);
    if (!conversation || !config || !project)
      throw new Error("Conversation not found");
    return { conversation, config, projectDir: project.directory };
  }
  setAgentProfile(
    conversationId: string,
    profile?: string,
    options: {
      preserveModel?: boolean;
      preserveThinking?: boolean;
      capabilityOverrides?: CapabilityOverridesDocument;
      overrides?: Partial<Pick<ConversationConfig, "model" | "reasoningLevel">>;
    } = {},
  ): Promise<ConversationConfig> {
    const previous = this.profileApplications.get(conversationId);
    const applying = (previous ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        const input = this.profileInput(conversationId);
        if (input.conversation.parentConversationId)
          throw new Error("Sub-agent profiles cannot be switched");
        const application = await this.options.agentProfiles.applyProfile({
          ...input,
          config: { ...input.config, ...options.overrides },
          ...(options.capabilityOverrides
            ? {
                capabilityOverrides: structuredClone(
                  options.capabilityOverrides,
                ),
              }
            : {}),
          ...(profile === undefined ? {} : { profile }),
          ...(options.preserveModel ? { preserveModel: true } : {}),
          ...(options.preserveThinking ? { preserveThinking: true } : {}),
        });
        return this.applyProfileApplication(conversationId, application);
      });
    this.profileApplications.set(conversationId, applying);
    const finished = () => {
      if (this.profileApplications.get(conversationId) === applying)
        this.profileApplications.delete(conversationId);
    };
    void applying.then(finished, finished);
    return applying;
  }
  private async applyProfileApplication(
    conversationId: string,
    application: AgentProfileApplication,
  ): Promise<ConversationConfig> {
    if (application.config.agentProfile !== application.applied.name)
      throw new Error("Applied profile name does not match config");
    const current =
      this.options.storage.conversations.getConfig(conversationId);
    if (!current) throw new Error("Conversation not found");
    const config = conversationConfigSchema.parse({
      ...current,
      ...application.config,
      conversationId,
    });
    appliedAgentProfileSchema.parse(application.applied);
    assertAppliedProfileConfigChange(application.applied, config);
    await this.options.agentProfiles.persistApplication(
      conversationId,
      application,
    );
    return this.conversations.applyAgentProfile(
      conversationId,
      application.config,
    );
  }
  configure(
    id: string,
    patch: Partial<Omit<ConversationConfig, "conversationId" | "agentProfile">>,
  ) {
    return this.conversations.configure(id, patch);
  }
  selectHead(id: string, eventId: string | null) {
    this.conversations.selectHead(id, eventId);
  }
  compact(id: string): void {
    if (!this.options.storage.conversations.get(id))
      throw new Error("Conversation not found");
    this.scheduler.requestCompaction(id);
  }
  cancelCompaction(id: string): void {
    this.scheduler.cancelCompaction(id);
  }
  delete(id: string) {
    return this.conversations.delete(id);
  }
  pause(id: string) {
    this.scheduler.pause(id);
  }
  resume(id: string) {
    this.scheduler.resume(id);
  }
  stop(id: string) {
    return this.scheduler.stop(id);
  }
  retryResponse(id: string): void {
    this.modelTurn.retryResponse(id);
  }
  forcePush(id: string) {
    return this.scheduler.forcePush(id);
  }
  continue(id: string) {
    this.scheduler.continue(id);
  }
  submitInput(
    request: SubmitInputRequest,
  ): QueuedInput | "delivered" | Promise<ToolCall | "delivered"> {
    const input = submitInputRequestSchema.parse(request);
    this.inputs.assertAcceptsSource(input.conversationId, input.source);
    const inline =
      input.source === "user"
        ? parseInlineCommandPrompt(input.text)
        : undefined;
    if (inline) {
      this.compactions.assertIdle(input.conversationId);
      return this.toolCalls.runUserCommand(
        input.conversationId,
        inline.command,
        true,
        { inputId: input.inputId, originalText: input.text },
      );
    }
    if (
      this.options.storage.toolCalls
        .listAll()
        .some(
          (call) =>
            call.origin === "user" && call.arguments.inputId === input.inputId,
        )
    )
      throw new Error("Input ID reused with different content");
    return this.inputs.submit(input);
  }
  cancelInput(inputId: string) {
    this.inputs.cancel(inputId);
  }
  async resolveInteraction(input: ResolveInteractionRequest): Promise<void> {
    const conversationId = this.options.storage.toolCalls.get(
      input.toolCallId,
    )?.conversationId;
    await this.toolCalls.resolveInteraction(input);
    if (conversationId) this.scheduler.wake(conversationId);
  }
  cancelAsyncBash(bashId: string) {
    return this.asyncBash.cancel(bashId);
  }
  subscribe(listener: (change: CoreChange) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  onExecutionFinished(
    listener: (result: ExecutionFinished) => void,
  ): () => void {
    this.finishedListeners.add(listener);
    return () => {
      this.finishedListeners.delete(listener);
    };
  }
  start(): Promise<void> {
    if (this.closing) throw new Error("Conversation core is closed");
    return (this.starting ??= recoverCore({
      storage: this.options.storage,
      inputs: this.inputs,
      asyncBash: this.asyncBash,
      toolCalls: this.toolCalls,
      status: this.status,
      scheduler: this.scheduler,
    }));
  }
  close(): Promise<void> {
    return (this.closing ??= this.shutdown().catch((error) => {
      this.closing = undefined;
      throw error;
    }));
  }
  private async shutdown(): Promise<void> {
    if (this.starting) await this.starting;
    this.inputs.close();
    await this.scheduler.close();
    await this.asyncBash.cancelForConversations(
      this.options.storage.conversations
        .listAll()
        .map((conversation) => conversation.id),
    );
    this.options.storage.close();
  }
}
export type { CoreChange } from "./runtime/core-change.js";
export type { ExecutionFinished } from "./runtime/conversation-runner.js";
