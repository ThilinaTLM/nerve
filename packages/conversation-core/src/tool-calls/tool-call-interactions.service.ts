import type { InteractionResolveResult } from "@nervekit/contracts/agent-configuration";
import type { CoreToolResolution } from "./core-tool.js";
import type {
  Interaction,
  InteractionResolution,
  ToolCall,
  ToolApprovalBinding,
} from "@nervekit/contracts/core";
import type { CoreToolContext } from "./core-tool.js";
import type { ToolCallServiceOptions } from "./tool-call.service.js";
import type { ToolCallSettlement } from "./tool-call-settlement.service.js";
import { effectivePermissionRuleSetId } from "./permission-rule-set.js";

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
        JSON.stringify(event.payload.interactionResolution) ===
          JSON.stringify(input.resolution)
      )
        return { status: "resolved" };
      throw new Error("Tool call already settled with another resolution");
    }
    if (this.hooks.isStopping(call.id)) return { status: "resolved" };
    let interaction = call.interaction;
    if (!interaction || interaction.kind !== input.resolution.kind)
      throw new Error("Resolution does not match the pending interaction");
    if (
      interaction.kind === "plan_review" &&
      interaction.resolution?.decision === "approve"
    ) {
      const sameResolution =
        interaction.resolutionRequestId === input.resolutionRequestId &&
        JSON.stringify(interaction.resolution) ===
          JSON.stringify(input.resolution);
      const handler = this.options.coreTools.get(call.toolName);
      if (!handler?.recover)
        throw new Error("Plan transition recovery is not configured");
      const controller = new AbortController();
      this.hooks.controllers.set(call.id, controller);
      try {
        const result = await handler.recover(
          call,
          this.hooks.toolContext(call, controller.signal),
        );
        const transition = await this.profileResult(
          call,
          result,
          controller.signal,
        );
        if (transition.status !== "refresh_required" || sameResolution)
          return transition;
      } finally {
        this.hooks.controllers.delete(call.id);
      }
      call = this.options.storage.toolCalls.get(call.id);
      if (!call?.interaction) return { status: "resolved" };
      interaction = call.interaction;
    }
    if (
      interaction.resolutionRequestId &&
      (interaction.resolutionRequestId !== input.resolutionRequestId ||
        JSON.stringify(interaction.resolution) !==
          JSON.stringify(input.resolution))
    )
      throw new Error("Interaction already resolved");
    if (call.state !== "awaiting_input" && call.state !== "awaiting_approval")
      return { status: "resolved" };
    if (
      input.resolution.kind === "approval" &&
      input.resolution.persistScope &&
      !call.supervision?.suggestedRules.length
    )
      throw new Error("No suggested permission rule to persist");
    const presentedBinding =
      input.resolution.kind === "approval"
        ? this.hooks.presentedApproval(call.id)
        : undefined;
    call = this.hooks.update(call.id, {
      interaction: {
        ...interaction,
        resolution: input.resolution,
        resolutionRequestId: input.resolutionRequestId,
      } as Interaction,
    });
    if (input.resolution.kind === "configuration_blocked") {
      if (input.resolution.decision === "cancel") {
        await this.hooks.settlement.settle(call, "cancelled", {
          content:
            "Tool call cancelled because execution configuration is blocked.",
        });
        return { status: "resolved" };
      }
      this.hooks.update(call.id, { state: "ready", executionClaim: null });
      void this.hooks
        .start([call.id])
        .catch((error) => console.error("Configuration retry failed:", error));
      return { status: "resolved" };
    }
    if (input.resolution.kind === "approval") {
      if (input.resolution.decision === "deny") {
        await this.hooks.settlement.settle(call, "denied", {
          content: "Approval denied.",
        });
        return { status: "resolved" };
      }
      if (input.resolution.persistScope) {
        const rule = call.supervision?.suggestedRules[0];
        if (rule === undefined)
          throw new Error("No suggested permission rule to persist");
        const { projectDir, config } = await this.options.context(
          call.conversationId,
        );
        // A profile change must not move a planning approval into the coding overlay.
        const authority = call.supervision?.authority;
        const ruleSetId =
          authority &&
          typeof authority === "object" &&
          !Array.isArray(authority) &&
          typeof authority.ruleSetId === "string"
            ? authority.ruleSetId
            : effectivePermissionRuleSetId(config);
        await this.options.permissions.addRule({
          scope: input.resolution.persistScope,
          conversationId: call.conversationId,
          projectDir,
          ruleSetId,
          rule,
        });
      }
      if (
        this.hooks.isStopping(call.id) ||
        !this.options.storage.toolCalls.get(call.id)
      )
        return { status: "resolved" };
      const binding = presentedBinding;
      // After restart there is no transient presentation: never invent a grant.
      this.hooks.update(call.id, {
        state: "ready",
        supervision: call.supervision
          ? { ...call.supervision, ...(binding ? { approval: binding } : {}) }
          : null,
      });
      // Tool failures settle through the worker's normal failed-outcome path.
      // Only unexpected persistence errors escape that path and need logging.
      void this.hooks.start([call.id]).catch((error) => {
        console.error("Approved tool worker failed:", error);
      });
      return { status: "resolved" };
    }
    const controller = new AbortController();
    this.hooks.controllers.set(call.id, controller);
    try {
      const handler = this.options.coreTools.get(call.toolName);
      const result = handler?.resolve
        ? await handler.resolve(
            call,
            input.resolution,
            this.hooks.toolContext(call, controller.signal),
          )
        : { content: JSON.stringify(input.resolution) };
      if ("kind" in result && result.kind === "profile_transition")
        return await this.profileResult(call, result, controller.signal);
      if (!controller.signal.aborted)
        await this.hooks.settlement.settle(call, "completed", result);
      return { status: "resolved" };
    } catch (error) {
      if (input.resolution.kind === "plan_review") {
        // Reopen promptly so the review remains actionable after a failed save or
        // SQLite commit. Recovery only previews; it cannot apply or enqueue.
        if (input.resolution.decision === "approve") {
          try {
            const handler = this.options.coreTools.get(call.toolName);
            if (handler?.recover)
              await this.profileResult(
                call,
                await handler.recover(
                  call,
                  this.hooks.toolContext(call, controller.signal),
                ),
                controller.signal,
              );
          } catch {
            // Keep accepted state when configuration cannot be refreshed. Reload
            // or explicit retry can reopen it once authority is available.
          }
        }
        throw error;
      }
      if (!controller.signal.aborted)
        await this.hooks.settlement.settle(call, "failed", {
          content: error instanceof Error ? error.message : String(error),
        });
      return { status: "resolved" };
    } finally {
      this.hooks.controllers.delete(call.id);
    }
  }
  private async profileResult(
    call: ToolCall,
    result: CoreToolResolution,
    signal: AbortSignal,
  ): Promise<InteractionResolveResult> {
    if (!("kind" in result) || result.kind !== "profile_transition")
      throw new Error("Expected profile transition result");
    const transition = result.transition;
    if (signal.aborted || !this.options.storage.toolCalls.get(call.id))
      return transition;
    if (transition.status === "applied")
      await this.hooks.settlement.settle(call, "completed", result.result);
    else if (
      transition.status === "refresh_required" &&
      call.interaction?.kind === "plan_review"
    ) {
      const request = transition.preview
        ? {
            ...call.interaction.request,
            targetProfile: transition.preview.targetProfile,
            expectedRevision: transition.preview.expectedRevision,
            expectedDigest: transition.preview.expectedDigest,
          }
        : call.interaction.request;
      this.hooks.update(call.id, {
        state: "awaiting_input",
        interaction: { kind: "plan_review", request },
      });
    }
    return transition;
  }
}
