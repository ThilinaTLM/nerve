import type { InteractionResolveResult } from "@nervekit/contracts/agent-configuration";
import type {
  Interaction,
  InteractionKind,
  InteractionResolution,
  ToolCall,
  ToolApprovalBinding,
} from "@nervekit/contracts/core";
import type { CoreToolContext } from "./core-tool.js";
import {
  InteractionError,
  type InteractionContext,
  type InteractionHandler,
  type InteractionHandlers,
  type InteractionOutcome,
} from "./interaction-handler.js";
import {
  createInteractionHandlers,
  sameResolution,
} from "./interaction-handlers.js";
import type { ToolCallServiceOptions } from "./tool-call-types.js";
import type { ToolCallSettlement } from "./tool-call-settlement.service.js";

export interface ResolveInteraction {
  toolCallId: string;
  resolutionRequestId: string;
  resolution: InteractionResolution;
}
export interface InteractionHooks {
  controllers: Map<string, AbortController>;
  settlement: ToolCallSettlement;
  isStopping(id: string): boolean;
  start(ids: string[]): Promise<void>;
  update(id: string, patch: Partial<ToolCall>): ToolCall;
  toolContext(call: ToolCall, signal: AbortSignal): CoreToolContext;
  presentedApproval(id: string): ToolApprovalBinding | undefined;
}
export class ToolCallInteractions {
  private readonly resolutions = new Map<
    string,
    { request: string; task: Promise<InteractionResolveResult> }
  >();
  constructor(
    private readonly options: ToolCallServiceOptions,
    private readonly hooks: InteractionHooks,
    private readonly handlers: InteractionHandlers = createInteractionHandlers(),
  ) {}
  async resolveInteraction(input: {
    toolCallId: string;
    resolutionRequestId: string;
    resolution: InteractionResolution;
  }): Promise<InteractionResolveResult> {
    const request = JSON.stringify([
      input.resolutionRequestId,
      input.resolution,
    ]);
    const active = this.resolutions.get(input.toolCallId);
    if (active) {
      // Retries and plan-review reconciliation join the identical in-flight request.
      if (active.request === request) return active.task;
      await active.task.catch(() => undefined);
      return this.resolveInteraction(input);
    }
    const task = this.resolve(input);
    const entry = { request, task };
    this.resolutions.set(input.toolCallId, entry);
    try {
      return await task;
    } finally {
      if (this.resolutions.get(input.toolCallId) === entry)
        this.resolutions.delete(input.toolCallId);
    }
  }

  /** Shared skeleton: replay, one handler dispatch, record, apply, act on the outcome. */
  private async resolve(input: {
    toolCallId: string;
    resolutionRequestId: string;
    resolution: InteractionResolution;
  }): Promise<InteractionResolveResult> {
    if (this.hooks.isStopping(input.toolCallId)) return { status: "resolved" };
    let call = this.options.storage.toolCalls.get(input.toolCallId);
    if (!call) {
      const event = this.options.storage.events.findToolCallResponse(
        input.toolCallId,
      );
      if (event?.type !== "tool_call_response")
        throw new Error(`Tool call not found: ${input.toolCallId}`);
      if (
        event.payload.resolutionRequestId === input.resolutionRequestId &&
        sameResolution(event.payload.interactionResolution, input.resolution)
      )
        return { status: "resolved" };
      throw new Error("Tool call already settled with another resolution");
    }
    if (this.hooks.isStopping(call.id)) return { status: "resolved" };
    const kind: InteractionKind = input.resolution.kind;
    if (call.interaction?.kind !== kind)
      throw new InteractionError(
        "Resolution does not match the pending interaction",
      );
    // One dispatch point; the registry is keyed by kind, so the cast is sound.
    const handler = this.handlers[kind] as InteractionHandler<InteractionKind>;
    const resolution = input.resolution;

    let proceed = false;
    const reconciled = await this.withContext(
      call,
      handler,
      input.resolutionRequestId,
      async (ctx) => {
        const reconciliation = await handler.reconcile?.(
          call!,
          resolution,
          ctx,
        );
        if (!reconciliation) return undefined;
        const result = await this.act(call!, reconciliation.outcome, ctx);
        proceed = reconciliation.proceed;
        return proceed ? undefined : { result };
      },
    );
    if (reconciled) return reconciled.result;
    if (proceed) {
      call = this.options.storage.toolCalls.get(call.id);
      if (!call?.interaction) return { status: "resolved" };
    }

    const interaction = call.interaction;
    if (
      interaction?.resolutionRequestId &&
      (interaction.resolutionRequestId !== input.resolutionRequestId ||
        !sameResolution(interaction.resolution, resolution))
    )
      throw new InteractionError("Interaction already resolved");
    if (call.state !== "awaiting_input" && call.state !== "awaiting_approval")
      return { status: "resolved" };
    handler.validate(call, resolution);
    const presentedApproval = this.hooks.presentedApproval(call.id);
    // Record before applying: idempotent retries rely on the stored resolution.
    call = this.hooks.update(call.id, {
      interaction: {
        ...interaction,
        resolution,
        resolutionRequestId: input.resolutionRequestId,
      } as Interaction,
    });
    const recorded = call;
    return this.withContext(
      recorded,
      handler,
      input.resolutionRequestId,
      async (ctx) => {
        try {
          return await this.act(
            recorded,
            await handler.apply(recorded, resolution, ctx),
            ctx,
          );
        } catch (error) {
          const recovery = handler.onError
            ? await handler.onError(recorded, resolution, error, ctx)
            : "rethrow";
          if (recovery === "rethrow") throw error;
          const result = await this.act(recorded, recovery, ctx);
          // A reopened review still reports the failure that caused it.
          if (recovery.kind === "reopen") throw error;
          return result;
        }
      },
      presentedApproval,
    );
  }

  private async withContext<T>(
    call: ToolCall,
    handler: InteractionHandler<InteractionKind>,
    resolutionRequestId: string,
    run: (ctx: InteractionContext) => Promise<T>,
    presentedApproval?: ToolApprovalBinding,
  ): Promise<T> {
    const controller = new AbortController();
    if (handler.cancellable) this.hooks.controllers.set(call.id, controller);
    try {
      return await run({
        signal: controller.signal,
        resolutionRequestId,
        presentedApproval,
        options: this.options,
        coreTool: (name) => this.options.coreTools.get(name),
        toolContext: (target) =>
          this.hooks.toolContext(target, controller.signal),
      });
    } finally {
      if (handler.cancellable) this.hooks.controllers.delete(call.id);
    }
  }

  /** The only place that acts on an outcome. */
  private async act(
    call: ToolCall,
    outcome: InteractionOutcome,
    ctx: InteractionContext,
  ): Promise<InteractionResolveResult> {
    const gone = () =>
      ctx.signal.aborted || !this.options.storage.toolCalls.get(call.id);
    switch (outcome.kind) {
      case "settle":
        if (!ctx.signal.aborted)
          await this.hooks.settlement.settle(
            call,
            outcome.status,
            outcome.result,
          );
        return { status: "resolved" };
      case "retry":
        if (
          this.hooks.isStopping(call.id) ||
          !this.options.storage.toolCalls.get(call.id)
        )
          return { status: "resolved" };
        this.hooks.update(call.id, outcome.patch);
        // Tool failures settle through the worker's normal failed-outcome path.
        // Only unexpected persistence errors escape that path and need logging.
        void this.hooks
          .start([call.id])
          .catch((error) =>
            console.error("Resumed tool worker failed:", error),
          );
        return { status: "resolved" };
      case "reopen":
        if (!gone())
          this.hooks.update(call.id, {
            state: "awaiting_input",
            interaction: outcome.interaction,
          });
        return outcome.result;
      case "transition":
        if (!gone() && outcome.transition.status === "applied")
          await this.hooks.settlement.settle(call, "completed", outcome.settle);
        return outcome.transition;
    }
  }
}
