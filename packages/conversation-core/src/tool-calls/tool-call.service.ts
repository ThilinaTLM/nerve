import { createId } from "@nervekit/contracts";
import {
  toolApprovalBindingMatches,
  type ToolApprovalBinding,
} from "@nervekit/contracts/core";
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
  inputs?: import("../inputs/input-queue.service.js").InputQueueService;
  storage: CoreStorage;
  assets: AssetStore;
  permissions: PermissionPort;
  host: ToolHostPort;
  emit(change: ToolCallChange): void;
  // Runs after the response append and row deletion have committed.
  onSettled?(conversationId: string): void;
  coreTools: Map<string, CoreToolHandler>;
  asyncBash: AsyncBashAdopter;
  context(
    conversationId: string,
  ):
    | { projectDir: string; config: ConversationConfig }
    | Promise<{ projectDir: string; config: ConversationConfig }>;
}

export class ToolCallService {
  private closed = false;
  private readonly requestCaptures = new Map<string, string>();
  private readonly presentedApprovals = new Map<string, ToolApprovalBinding>();
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
      presentedApproval: (id) => this.presentedApprovals.get(id),
    });
  }

  createFromAssistantMessage(
    conversationId: string,
    turnId: string,
    assistantEvent: ConversationEvent,
    requestCaptureId?: string,
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
      if (requestCaptureId)
        for (const row of rows)
          this.requestCaptures.set(row.id, requestCaptureId);
      return rows;
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const controller of this.controllers.values())
      controller.abort(shutdownReason);
    await this.settlement.close();
    this.requestCaptures.clear();
    this.presentedApprovals.clear();
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

  resolveInteraction(
    input: ResolveInteraction,
  ): Promise<
    import("@nervekit/contracts/agent-configuration").InteractionResolveResult
  > {
    return this.interactions.resolveInteraction(input);
  }

  async cancel(
    conversationId: string,
    input: { turnId?: string; reason?: string } = {},
  ): Promise<void> {
    const rows = this.openRows(conversationId).filter(
      (call) => !input.turnId || call.turnId === input.turnId,
    );
    // Own every targeted call before abort listeners can wake any worker.
    for (const call of rows) this.stopping.add(call.id);
    for (const call of rows) this.controllers.get(call.id)?.abort();
    await Promise.all(
      rows.map(async (call) => {
        const current = this.options.storage.toolCalls.get(call.id);
        if (!current) {
          this.stopping.delete(call.id);
          return;
        }
        // Settlement deduplication preserves a result already owned before cancellation.
        try {
          await this.settlement.settle(
            current,
            "cancelled",
            {
              content:
                input.reason ?? "Tool call cancelled. No rollback is implied.",
            },
            current.executionClaim,
          );
        } finally {
          // Retained rows stay fenced if persistence failed; cancellation can be retried.
          if (!this.options.storage.toolCalls.get(call.id))
            this.stopping.delete(call.id);
        }
      }),
    );
  }

  /** Health publication hook: repair/reload only retries admission, never grants approval. */
  async retryConfigurationBlocked(conversationId?: string): Promise<void> {
    const ids: string[] = [];
    for (const call of this.options.storage.toolCalls.listAll()) {
      if (
        call.state !== "awaiting_input" ||
        call.interaction?.kind !== "configuration_blocked" ||
        (conversationId && call.conversationId !== conversationId) ||
        this.stopping.has(call.id)
      )
        continue;
      this.update(call.id, {
        state: "ready",
        executionClaim: null,
        interaction: null,
      });
      ids.push(call.id);
    }
    await this.start(ids);
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
        } else if (
          call.state === "awaiting_approval" ||
          call.interaction?.kind === "configuration_blocked"
        ) {
          this.update(call.id, { state: "ready", interaction: null });
          ids.push(call.id);
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
    const task = Promise.resolve()
      .then(() => this.process(id))
      .finally(() => {
        this.workers.delete(id);
        this.controllers.delete(id);
        if (this.closed || !this.options.storage.toolCalls.get(id)) {
          this.requestCaptures.delete(id);
          this.presentedApprovals.delete(id);
        }
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
      if (call.state !== "supervising" && call.state !== "ready") return;
      const child = this.options.storage.conversations.get(
        call.conversationId,
      )?.parentConversationId;
      if (
        child &&
        (call.toolName === "ask_user" ||
          call.toolName === "plan_present" ||
          call.toolName.startsWith("subagent_"))
      ) {
        const reason =
          "Child agents cannot ask users, present plans, or delegate/manage sub-agents.";
        call = this.update(id, {
          supervision: {
            decision: "deny",
            reason,
            suggestedRules: [],
            authority: { role: "child" },
          },
        });
        await this.settlement.settle(call, "denied", { content: reason });
        return;
      }
      const ctx = this.toolContext(call, controller.signal);
      const handler = this.options.coreTools.get(call.toolName);
      const { config, projectDir } = await this.options.context(
        call.conversationId,
      );
      const artifactDir = handler
        ? ""
        : await this.options.assets.directory(
            `conversations/${call.conversationId}/tool-calls/${call.id}/files`,
          );
      if (!this.options.permissions.prepareAdmission)
        throw new Error("Execution admission is not configured");
      if (!handler && !this.options.host.prepareExecution)
        throw new Error("Prepared tool execution is not configured");
      const prepared = handler
        ? {
            args,
            cwd: config.workingDirectory,
            target: {
              kind: "core",
              toolName: call.toolName,
              cwd: config.workingDirectory,
            },
            dispatch: () => handler.execute(call!, ctx),
          }
        : await this.options.host.prepareExecution!({
            toolCallId: call.id,
            conversationId: call.conversationId,
            origin: call.origin,
            toolName: call.toolName,
            projectDir,
            args,
            cwd: config.workingDirectory,
            signal: ctx.signal,
            onProgress: ctx.onProgress,
            artifactDir,
            requestCaptureId: this.requestCaptures.get(call.id),
          });
      if ("kind" in prepared) {
        if (!controller.signal.aborted)
          this.update(id, {
            state: "awaiting_input",
            executionClaim: null,
            interaction: {
              kind: "configuration_blocked",
              request: prepared.request,
            },
          });
        return;
      }
      let result;
      for (;;) {
        const admission = await this.options.permissions.prepareAdmission({
          toolCallId: call.id,
          conversationId: call.conversationId,
          projectDir,
          toolName: call.toolName,
          origin: call.origin,
          args: prepared.args,
          cwd: prepared.cwd,
          target: prepared.target,
          requestCaptureId: this.requestCaptures.get(call.id),
        });
        if (
          controller.signal.aborted ||
          this.stopping.has(id) ||
          !this.options.storage.toolCalls.get(id)
        )
          return;
        const decision = admission.check();
        if (decision.kind === "stale") continue;
        if (decision.kind === "blocked") {
          this.presentedApprovals.delete(id);
          this.update(id, {
            state: "awaiting_input",
            executionClaim: null,
            interaction: {
              kind: "configuration_blocked",
              request: decision.request,
            },
          });
          return;
        }
        const { evidence } = decision;
        const supervision = { ...decision.supervision };
        delete supervision.approval;
        const approved = call.supervision?.approval;
        call = this.update(id, {
          supervision: {
            ...supervision,
            ...(toolApprovalBindingMatches(approved, evidence.binding)
              ? { approval: approved }
              : {}),
          },
        });
        if (supervision.decision === "deny") {
          this.presentedApprovals.delete(id);
          await this.settlement.settle(call, "denied", {
            content:
              supervision.reason ?? "Denied by current permission policy.",
          });
          return;
        }
        if (
          supervision.decision === "approval" &&
          !toolApprovalBindingMatches(approved, evidence.binding)
        ) {
          this.presentedApprovals.set(id, evidence.binding);
          this.update(id, {
            state: "awaiting_approval",
            executionClaim: null,
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
        // No await between the synchronous current-policy check and dispatch.
        call = this.update(id, {
          state: "running",
          // Keep the durable resolution receipt for settlement and restart readmission.
          executionClaim: createId("tool"),
        });
        // Publication callbacks may synchronously mutate policy; recheck after them.
        const final = admission.check();
        if (controller.signal.aborted || this.stopping.has(id)) return;
        if (
          final.kind !== "policy" ||
          final.supervision.decision !== supervision.decision ||
          !toolApprovalBindingMatches(evidence.binding, final.evidence.binding)
        ) {
          call = this.update(id, { state: "ready", executionClaim: null });
          continue;
        }
        this.settlement.recordExecutionStart(call);
        this.presentedApprovals.delete(id);
        const dispatched = prepared.dispatch();
        result = await dispatched;
        break;
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
        let bash: AsyncBash;
        try {
          bash = await this.options.asyncBash.adopt({
            conversationId: call.conversationId,
            toolCallId: call.id,
            command: String(call.arguments.command ?? ""),
            cwd:
              typeof objectDetails(result.result.details).cwd === "string"
                ? String(objectDetails(result.result.details).cwd)
                : config.workingDirectory,
            process: result.process,
          });
        } catch (error) {
          if (controller.signal.aborted || !this.holdsClaim(call))
            await result.process.cancel();
          throw error;
        }
        if (controller.signal.aborted || !this.holdsClaim(call)) {
          await result.process.cancel();
          return;
        }
        await this.settlement.settle(
          call,
          "completed",
          {
            ...result.result,
            content: objectDetails(result.result.details).backgroundStart
              ? `Started async bash ${bash.id}.${result.result.content ? `\n${result.result.content}` : ""}`
              : `Still running; continues as async bash ${bash.id}. You will be notified on exit.${result.result.content ? `\n${result.result.content}` : ""}`,
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
      if (this.closed || this.stopping.has(id)) return;
      const current = this.options.storage.toolCalls.get(id);
      if (!current || (call.executionClaim && !this.holdsClaim(call))) return;
      const aborted = controller.signal.aborted;
      const confirmed = error instanceof Error && error.name === "AbortError";
      await this.settlement.settle(
        current,
        aborted ? (confirmed ? "cancelled" : "indeterminate") : "failed",
        {
          content: error instanceof Error ? error.message : String(error),
          ...(error !== null && typeof error === "object" && "details" in error
            ? { details: error.details }
            : {}),
        },
        current.executionClaim,
      );
    }
  }

  private holdsClaim(call: ToolCall): boolean {
    if (this.closed || this.stopping.has(call.id)) return false;
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
      requestCaptureId: this.requestCaptures.get(call.id),
      signal,
      onProgress: (update) => {
        if (
          !this.closed &&
          !this.stopping.has(call.id) &&
          !signal.aborted &&
          this.options.storage.toolCalls.get(call.id)
        )
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
