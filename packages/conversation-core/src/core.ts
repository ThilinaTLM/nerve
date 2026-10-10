import { toolExecutionResultSchema } from "@nervekit/contracts/tools";
import type { TransferredConversationEvent } from "@nervekit/contracts/core";
import { submitInputRequestSchema } from "@nervekit/contracts/core";
import { parseInlineCommandPrompt } from "@nervekit/contracts/completions";
import type {
  QueuedInput,
  ToolCall,
  ConversationSnapshot,
  ConversationConfig,
  ListConversationsRequest,
  ResolveInteractionRequest,
  SubmitInputRequest,
  UpdateConversationRequest,
} from "@nervekit/contracts/core";
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
import { ConversationScheduler } from "./runtime/scheduler.js";
import { openExecutionId, StatusService } from "./runtime/status.js";

export interface ConversationCoreOptions {
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
  coreTools?: Iterable<CoreToolHandler>;
  readPlan?: CoreToolHandlerOptions["readPlan"];
}
export class ConversationCore {
  readonly projects: ProjectService;
  readonly trust: TrustedResourceService;
  readonly conversations: ConversationService;
  readonly inputs: InputQueueService;
  readonly toolCalls: ToolCallService;
  readonly asyncBash: AsyncBashService;
  readonly assets: AssetStore;
  private readonly listeners = new Set<(change: CoreChange) => void>();
  private readonly finishedListeners = new Set<
    (result: ExecutionFinished) => void
  >();
  private readonly coreTools = new Map<string, CoreToolHandler>();
  private readonly scheduler: ConversationScheduler;
  private readonly runner: ConversationRunner;
  private readonly status: StatusService;
  private starting?: Promise<void>;
  private closing?: Promise<void>;
  constructor(private readonly options: ConversationCoreOptions) {
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
    this.status = new StatusService(options.storage, publish, now, (result) => {
      for (const listener of this.finishedListeners) {
        try {
          listener(result);
        } catch {
          /* Observers own their error reporting. */
        }
      }
    });
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
      context: (id) => {
        const conversation = options.storage.conversations.get(id);
        const config = options.storage.conversations.getConfig(id);
        const project =
          conversation && options.storage.projects.get(conversation.projectId);
        if (!project || !config)
          throw new Error("Conversation context not found");
        return { projectDir: project.directory, config };
      },
    });
    const modelTurn = new ModelTurn(
      options.models,
      options.turnResources,
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
      modelTurn,
      status: this.status,
      emit,
      now,
    });
    this.scheduler = new ConversationScheduler({
      storage: options.storage,
      inputs: this.inputs,
      toolCalls: this.toolCalls,
      asyncBash: this.asyncBash,
      runner: this.runner,
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
      isExecuting: (id) => this.scheduler.isExecuting(id),
      stop: (id) => this.scheduler.stop(id),
      status: this.status,
    });
    this.projects = new ProjectService(
      options.storage,
      (id) => this.delete(id),
      now,
    );
    this.trust = new TrustedResourceService(options.storage, now);
    for (const handler of createCoreToolHandlers({
      assets: this.assets,
      configure: (id, patch) => {
        this.configure(id, patch);
      },
      readPlan: options.readPlan,
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
    return this.conversations.create(input);
  }
  listConversations(input: ListConversationsRequest) {
    return this.options.storage.conversations.list(input);
  }
  getSnapshot(id: string): ConversationSnapshot {
    return this.conversations.snapshot(id);
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
    return {
      agentProjection: event.payload.agentProjection,
      result: toolExecutionResultSchema.parse(
        JSON.parse((await this.assets.read(payload.id)).toString("utf8")),
      ),
    };
  }
  getTree(id: string) {
    return this.options.storage.events.treeNodes(id);
  }
  update(id: string, patch: UpdateConversationRequest["patch"]) {
    this.conversations.update(id, patch);
  }
  configure(
    id: string,
    patch: Partial<Omit<ConversationConfig, "conversationId">>,
  ) {
    return this.conversations.configure(id, patch);
  }
  selectHead(id: string, eventId: string | null) {
    this.conversations.selectHead(id, eventId);
  }
  async compact(id: string): Promise<void> {
    this.conversations.assertQuiescent(id);
    await this.scheduler.compact(id);
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
    const inline =
      input.source === "user"
        ? parseInlineCommandPrompt(input.text)
        : undefined;
    if (inline)
      return this.toolCalls.runUserCommand(
        input.conversationId,
        inline.command,
        true,
        { inputId: input.inputId, originalText: input.text },
      );
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
