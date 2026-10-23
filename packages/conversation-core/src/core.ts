import type { AgentConfigurationPort } from "./configuration.js";
import { createId } from "@nervekit/contracts";
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
  ClockPort,
  ModelPort,
  PermissionPort,
  ProcessPort,
  ToolHostPort,
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
  configuration: AgentConfigurationPort;
  storage: CoreStorage;
  dataDir: string;
  models: ModelPort;
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
  private readonly emit: (change: CoreChange) => void;
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
    this.emit = emit;
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
      resolvedInteractionResult: (id, resolution, toolCallId) =>
        resolution.kind === "plan_review" && resolution.decision === "approve"
          ? options.configuration.profiles.reconcile({
              ...resolution.confirmation,
              conversationId: id,
              kind: "plan-approval",
              toolCallId,
            })
          : Promise.resolve({ status: "resolved" }),
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
      options.configuration,
      () => [...this.coreTools.values()].map((handler) => handler.definition),
      emit,
      this.assets,
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
      configuration: options.configuration,
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
      compactions: this.compactions,
      isExecuting: (id) => this.scheduler.isExecuting(id),
      stop: (id) => this.scheduler.stop(id),
      status: this.status,
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
      profiles: options.configuration.profiles,
      readPlan: options.readPlan,
      planApprovalProfile: options.planApprovalProfile,
      onPlanRejected: (id) => this.scheduler.pause(id),
    }).values())
      this.registerCoreTool(handler);
    for (const handler of options.coreTools ?? [])
      this.registerCoreTool(handler);
  }
  publishConfigurationEvent(
    event: import("@nervekit/contracts/core").ConversationEvent,
  ): void {
    this.emit({
      kind: "event_appended",
      conversationId: event.conversationId,
      event,
    });
  }
  registerCoreTool(handler: CoreToolHandler): void {
    this.coreTools.set(handler.definition.name, handler);
  }
  createConversation(
    input: CreateConversationInput,
  ): Promise<ConversationSnapshot> {
    input = { ...input, id: input.id ?? createId("conv") };
    const pending = this.creations.get(input.id!);
    if (pending) return pending.then(() => this.conversations.create(input));
    const creating = Promise.resolve().then(() =>
      this.createAndApplyProfile(input),
    );
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
    const existing =
      input.id && this.options.storage.conversations.get(input.id);
    const prepared = existing
      ? undefined
      : await this.options.configuration.prepareCreation(input);
    const created = await this.conversations.create(input, prepared);
    if (existing) return created;
    try {
      await this.options.configuration.initializeConversation({
        ...input,
        id: created.conversation.id,
      });
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
  async previewSystemPrompt(input: PreviewSystemPromptParams) {
    const saved = "conversationId" in input;
    const conversation = saved
      ? this.options.storage.conversations.get(input.conversationId)
      : { projectId: input.projectId, parentConversationId: null };
    if (!conversation) throw new Error("Conversation not found");
    const project = this.options.storage.projects.get(conversation.projectId);
    if (!project) throw new Error("Project not found");
    const config = saved
      ? this.options.storage.conversations.getConfig(input.conversationId)
      : input.config;
    return this.options.configuration.capturePreview({
      conversation,
      projectDir: project.directory,
      config: {
        systemPrompt: config?.systemPrompt ?? null,
        instructions: config?.instructions ?? null,
        workingDirectory: config?.workingDirectory ?? project.directory,
      },
      coreTools: [...this.coreTools.values()].map(
        (handler) => handler.definition,
      ),
      ...(!saved
        ? { overrides: input.overrides, agentProfile: input.agentProfile }
        : {}),
    });
  }
  async contextUsage(id: string): Promise<ContextUsage> {
    const path = this.runner.path(id);
    const projection = await loadProjectionOptions(path, this.assets);
    const tokens = Math.round(estimatePathUsage(path, projection).tokens);
    const window = await this.options.configuration
      .captureCompaction(id)
      .then((capture) => this.options.models.resolve(capture.model))
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
  setAgentProfile(
    input: import("@nervekit/contracts/agent-configuration").SetConversationAgentProfileRequest,
  ) {
    if (this.creations.has(input.conversationId))
      throw new Error("Conversation configuration is still being initialized");
    return this.options.configuration.profiles.apply({
      ...input,
      kind: "profile",
    });
  }
  previewAgentProfile(id: string, profile: string) {
    return this.options.configuration.profiles.preview(id, profile);
  }
  configure(
    id: string,
    patch: Partial<
      Pick<
        ConversationConfig,
        "systemPrompt" | "instructions" | "workingDirectory"
      >
    >,
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
  async reconcilePlanReviews(conversationId?: string): Promise<void> {
    for (const call of this.options.storage.toolCalls.listAll()) {
      if (
        (conversationId && call.conversationId !== conversationId) ||
        call.interaction?.kind !== "plan_review" ||
        call.interaction.resolution?.decision !== "approve" ||
        !call.interaction.resolutionRequestId
      )
        continue;
      await this.resolveInteraction({
        toolCallId: call.id,
        resolutionRequestId: call.interaction.resolutionRequestId,
        resolution: call.interaction.resolution,
      });
    }
  }
  retryConfigurationBlocked(conversationId?: string): Promise<void> {
    return this.toolCalls.retryConfigurationBlocked(conversationId);
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
    if (this.creations.has(input.conversationId))
      throw new Error("Conversation configuration is still being initialized");
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
  async resolveInteraction(
    input: ResolveInteractionRequest,
  ): Promise<
    import("@nervekit/contracts/agent-configuration").InteractionResolveResult
  > {
    const conversationId = this.options.storage.toolCalls.get(
      input.toolCallId,
    )?.conversationId;
    const result = await this.toolCalls.resolveInteraction(input);
    if (
      conversationId &&
      (result.status === "applied" || result.status === "resolved")
    )
      this.scheduler.wake(conversationId);
    return result;
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
