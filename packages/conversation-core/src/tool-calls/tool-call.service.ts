import { createId } from "@nervekit/contracts";
import { shutdownReason } from "../runtime/shutdown.js";
import type {
  AsyncBash,
  ConversationConfig,
  ConversationEvent,
  ToolCall,
  ToolProgress,
} from "@nervekit/contracts/core";
import type { AssetStore } from "../assets/asset-store.js";
import type {
  BackgroundProcess,
  PermissionPort,
  ToolHostPort,
} from "../ports.js";
import type { CoreStorage } from "../storage/core-storage.js";
import type { CoreToolContext, CoreToolHandler } from "./core-tool.js";
import { ToolCallSettlement } from "./tool-call-settlement.service.js";
import {
  ToolCallInteractions,
  type ResolveInteraction,
} from "./tool-call-interactions.service.js";
export type {
  CoreToolContext,
  CoreToolHandler,
  CoreToolOutcome,
} from "./core-tool.js";

export type ToolCallChange =
  | { kind: "event_appended"; conversationId: string; event: ConversationEvent }
  | {
      kind: "tool_call_changed";
      conversationId: string;
      toolCall: ToolCall | { id: string; removed: true };
    }
  | {
      kind: "live";
      conversationId: string;
      delta: {
        type: "tool_progress";
        toolCallId: string;
        update: ToolProgress;
      };
    };
export interface AsyncBashAdopter {
  adopt(input: {
    conversationId: string;
    toolCallId: string;
    command: string;
    cwd: string;
    process: BackgroundProcess;
  }): AsyncBash | Promise<AsyncBash>;
}
export interface ToolCallServiceOptions {
  storage: CoreStorage;
  assets: AssetStore;
  permissions: PermissionPort;
  host: ToolHostPort;
  emit(change: ToolCallChange): void;
  // Runs after the response append and row deletion, inside their transaction.
  onSettled?(conversationId: string): void;
  coreTools: Map<string, CoreToolHandler>;
  asyncBash: AsyncBashAdopter;
  context(conversationId: string): {
    projectDir: string;
    config: ConversationConfig;
  };
}

export class ToolCallService {
  private closed = false;
  private readonly workers = new Map<string, Promise<void>>();
  private readonly stopping = new Set<string>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly interactions: ToolCallInteractions;
  private readonly settlement: ToolCallSettlement;

  constructor(private readonly options: ToolCallServiceOptions) {
    this.settlement = new ToolCallSettlement(options);
    this.interactions = new ToolCallInteractions(options, {
      controllers: this.controllers,
      settlement: this.settlement,
      isStopping: (id) => this.closed || this.stopping.has(id),
      start: (ids) => this.start(ids),
      update: (id, patch) => this.update(id, patch),
      toolContext: (call, signal) => this.toolContext(call, signal),
    });
  }

  createFromAssistantMessage(
    conversationId: string,
    turnId: string,
    assistantEvent: ConversationEvent,
  ): ToolCall[] {
    if (
      assistantEvent.type !== "assistant_message" ||
      assistantEvent.conversationId !== conversationId ||
      assistantEvent.turnId !== turnId
    )
      throw new Error("Invalid assistant tool-call source");
    return this.options.storage.transaction(() => {
      const existing = this.openRows(conversationId).filter(
        (call) => call.assistantEventId === assistantEvent.id,
      );
      if (existing.length) return existing;
      const settledIndexes = new Set(
        this.options.storage.events
          .since(conversationId, 0)
          .flatMap((event) =>
            event.type === "tool_call_response" &&
            event.payload.assistantEventId === assistantEvent.id
              ? [event.payload.contentIndex]
              : [],
          ),
      );
      const rows: ToolCall[] = [];
      assistantEvent.payload.content.forEach((block, contentIndex) => {
        if (block.type !== "toolCall" || settledIndexes.has(contentIndex))
          return;
        rows.push(
          this.options.storage.toolCalls.insert({
            id: createId("tool"),
            conversationId,
            turnId,
            providerCallId: block.id,
            assistantEventId: assistantEvent.id,
            contentIndex,
            origin: "model",
            toolName: block.name,
            arguments: block.arguments,
            state: "supervising",
            supervision: null,
            interaction: null,
            executionClaim: null,
            updatedAt: new Date().toISOString(),
          }),
        );
      });
      return rows;
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const controller of this.controllers.values()) controller.abort(shutdownReason);
    await this.settlement.close();
  }

  async start(toolCallIds: string[]): Promise<void> {
    await Promise.all(toolCallIds.map((id) => this.startOne(id)));
  }

  openRows(conversationId: string): ToolCall[] {
    return this.options.storage.toolCalls.list(conversationId);
  }
  hasPendingInteraction(conversationId: string): boolean {
    return this.openRows(conversationId).some(
      (call) =>
        call.state === "awaiting_input" || call.state === "awaiting_approval",
    );
  }
  waitForTurn(conversationId: string, turnId: string): Promise<void> {
    return this.settlement.waitForTurn(conversationId, turnId);
  }

  async runUserCommand(
    conversationId: string,
    command: string,
    includeInContext = true,
    submission?: { inputId: string; originalText: string },
  ): Promise<ToolCall | "delivered"> {
    if (this.closed) throw new Error("Tool-call service is closed");
    if (submission) {
      const storage = this.options.storage;
      const pending = storage.toolCalls
        .listAll()
        .find(
          (row) =>
            row.origin === "user" &&
            row.arguments.inputId === submission.inputId,
        );
      if (pending) {
        if (
          pending.conversationId !== conversationId ||
          pending.arguments.originalText !== submission.originalText ||
          pending.arguments.command !== command ||
          pending.arguments.includeInContext !== includeInContext
        )
          throw new Error("Input ID reused with different content");
        return pending;
      }
      const delivered = storage.events.findByInputId(submission.inputId);
      if (delivered) {
        if (
          delivered.conversationId !== conversationId ||
          delivered.type !== "tool_call_response" ||
          delivered.payload.origin !== "user" ||
          delivered.payload.arguments.originalText !==
            submission.originalText ||
          delivered.payload.arguments.command !== command ||
          (delivered.llmRepresentation !== "none") !== includeInContext
        )
          throw new Error("Input ID reused with different content");
        return "delivered";
      }
      if (storage.inputs.get(submission.inputId))
        throw new Error("Input ID already belongs to a queued prompt");
    }
    const call = this.options.storage.toolCalls.insert({
      id: createId("tool"),
      conversationId,
      turnId: createId("turn"),
      providerCallId: null,
      assistantEventId: null,
      contentIndex: null,
      origin: "user",
      toolName: "bash",
      arguments: { command, includeInContext, ...submission },
      state: "supervising",
      supervision: null,
      interaction: null,
      executionClaim: null,
      updatedAt: new Date().toISOString(),
    });
    this.changed(call);
    await this.start([call.id]);
    return call;
  }

  resolveInteraction(input: ResolveInteraction): Promise<void> {
    return this.interactions.resolveInteraction(input);
  }

  async cancel(
    conversationId: string,
    input: { turnId?: string } = {},
  ): Promise<void> {
    const rows = this.openRows(conversationId).filter(
      (call) => !input.turnId || call.turnId === input.turnId,
    );
    for (const call of rows) {
      this.stopping.add(call.id);
      this.controllers.get(call.id)?.abort();
    }
    // Give a synchronously aborting worker a chance to acknowledge cancellation.
    await Promise.resolve();
    await Promise.all(
      rows.map(async (call) => {
        const current = this.options.storage.toolCalls.get(call.id);
        if (!current) {
          this.stopping.delete(call.id);
          return;
        }
        const outcome =
          current.state === "running" ? "indeterminate" : "cancelled";
        await this.settlement.settle(
          current,
          outcome,
          {
            content:
              outcome === "indeterminate"
                ? "Stopped; the external effect could not be confirmed."
                : "Tool call cancelled.",
          },
          current.executionClaim,
        );
        if (!this.options.storage.toolCalls.get(call.id))
          this.stopping.delete(call.id);
      }),
    );
  }

  async recover(): Promise<void> {
    const ids: string[] = [];
    for (const call of this.options.storage.toolCalls.listAll()) {
      if (
        call.state === "awaiting_input" ||
        call.state === "awaiting_approval"
      ) {
        if (
          call.interaction?.resolution &&
          call.interaction.resolutionRequestId
        ) {
          await this.resolveInteraction({
            toolCallId: call.id,
            resolutionRequestId: call.interaction.resolutionRequestId,
            resolution: call.interaction.resolution,
          });
        }
        continue;
      }
      if (call.state === "running") {
        if (!this.options.host.isReplaySafe(call.toolName)) {
          await this.settlement.settle(
            call,
            "indeterminate",
            {
              content:
                "Execution was interrupted; its external effect is unknown.",
            },
            call.executionClaim,
          );
          continue;
        }
        this.update(call.id, { state: "ready", executionClaim: null });
      }
      ids.push(call.id);
    }
    await this.start(ids);
  }

  private startOne(id: string): Promise<void> {
    if (this.closed || this.stopping.has(id)) return Promise.resolve();
    const active = this.workers.get(id);
    if (active) return active;
    const task = this.process(id).finally(() => {
      this.workers.delete(id);
      this.controllers.delete(id);
    });
    this.workers.set(id, task);
    return task;
  }

  private async process(id: string): Promise<void> {
    let call = this.options.storage.toolCalls.get(id);
    if (!call) return;
    this.changed(call);
    const controller = new AbortController();
    this.controllers.set(id, controller);
    const args =
      call.origin === "user"
        ? { command: call.arguments.command }
        : call.arguments;
    try {
      if (call.state === "supervising") {
        const { projectDir, config } = this.options.context(
          call.conversationId,
        );
        const supervision = await this.options.permissions.evaluate({
          conversationId: call.conversationId,
          projectDir,
          ruleSetId: config.permissionRuleSetId,
          toolName: call.toolName,
          args,
          cwd: config.workingDirectory,
        });
        if (
          controller.signal.aborted ||
          this.options.storage.toolCalls.get(id)?.state !== "supervising"
        )
          return;
        call = this.update(id, { supervision });
        if (supervision.decision === "deny") {
          await this.settlement.settle(call, "denied", {
            content: supervision.reason ?? "Denied by permission policy.",
          });
          return;
        }
        if (supervision.decision === "approval") {
          this.update(id, {
            state: "awaiting_approval",
            interaction: {
              kind: "approval",
              request: {
                reason: supervision.reason ?? "Approval required",
                suggestedRules: supervision.suggestedRules,
              },
            },
          });
          return;
        }
        call = this.update(id, { state: "ready" });
      }
      if (call.state !== "ready" || controller.signal.aborted) return;
      call = this.update(id, {
        state: "running",
        executionClaim: createId("tool"),
      });
      const ctx = this.toolContext(call, controller.signal);
      const handler = this.options.coreTools.get(call.toolName);
      const { config } = this.options.context(call.conversationId);
      let result;
      if (handler) result = await handler.execute(call, ctx);
      else {
        const artifactDir = await this.options.assets.directory(`conversations/${call.conversationId}/tool-calls/${call.id}/files`);
        if (controller.signal.aborted) return;
        result = await this.options.host.execute({
          toolCallId: call.id, conversationId: call.conversationId,
          toolName: call.toolName, args, cwd: config.workingDirectory,
          signal: ctx.signal, onProgress: ctx.onProgress, artifactDir,
        });
      }
      if (controller.signal.aborted || !this.holdsClaim(call)) {
        if (result.kind === "backgrounded") await result.process.cancel();
        return;
      }
      if (result.kind === "awaiting_input") {
        this.update(id, {
          state: "awaiting_input",
          interaction: result.interaction,
          executionClaim: null,
        });
        return;
      }
      if (result.kind === "backgrounded") {
        const bash = await this.options.asyncBash.adopt({
          conversationId: call.conversationId,
          toolCallId: call.id,
          command: String(call.arguments.command ?? ""),
          cwd: config.workingDirectory,
          process: result.process,
        });
        if (controller.signal.aborted || !this.holdsClaim(call)) {
          await result.process.cancel();
          return;
        }
        await this.settlement.settle(
          call,
          "completed",
          {
            ...result.result,
            content: `${result.result.content ?? "Command promoted to background."}\nAsync bash: ${bash.id}`,
            details: {
              ...objectDetails(result.result.details),
              asyncBashId: bash.id,
            },
          },
          call.executionClaim,
        );
      } else {
        await this.settlement.settle(
          call,
          "completed",
          result.result,
          call.executionClaim,
        );
      }
    } catch (error) {
      if (this.closed) return;
      const current = this.options.storage.toolCalls.get(id);
      if (!current || (call.executionClaim && !this.holdsClaim(call))) return;
      const aborted = controller.signal.aborted;
      const confirmed = error instanceof Error && error.name === "AbortError";
      await this.settlement.settle(
        current,
        aborted ? (confirmed ? "cancelled" : "indeterminate") : "failed",
        { content: error instanceof Error ? error.message : String(error) },
        current.executionClaim,
      );
    }
  }

  private holdsClaim(call: ToolCall): boolean {
    if (this.closed) return false;
    const current = this.options.storage.toolCalls.get(call.id);
    return (
      current?.state === "running" &&
      current.executionClaim === call.executionClaim
    );
  }
  private update(id: string, patch: Partial<ToolCall>): ToolCall {
    const row = this.options.storage.toolCalls.update(id, {
      ...patch,
      updatedAt: new Date().toISOString(),
    });
    this.changed(row);
    return row;
  }
  private changed(call: ToolCall): void {
    this.options.emit({
      kind: "tool_call_changed",
      conversationId: call.conversationId,
      toolCall: call,
    });
  }
  private toolContext(call: ToolCall, signal: AbortSignal): CoreToolContext {
    return {
      conversationId: call.conversationId,
      signal,
      onProgress: (update) => {
        if (!signal.aborted && this.options.storage.toolCalls.get(call.id))
          this.options.emit({
            kind: "live",
            conversationId: call.conversationId,
            delta: { type: "tool_progress", toolCallId: call.id, update },
          });
      },
    };
  }
}

function objectDetails(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
