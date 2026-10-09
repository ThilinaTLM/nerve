import type {
  Interaction,
  InteractionResolution,
  ToolCall,
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
}
export class ToolCallInteractions {
  private readonly resolutions = new Map<string, Promise<void>>();
  constructor(
    private readonly options: ToolCallServiceOptions,
    private readonly hooks: InteractionHooks,
  ) {}
  async resolveInteraction(input: {
    toolCallId: string;
    resolutionRequestId: string;
    resolution: InteractionResolution;
  }): Promise<void> {
    const active = this.resolutions.get(input.toolCallId);
    if (active) {
      await active;
      return this.resolveInteraction(input);
    }
    const task = this.resolve(input);
    this.resolutions.set(input.toolCallId, task);
    try {
      await task;
    } finally {
      this.resolutions.delete(input.toolCallId);
    }
  }

  private async resolve(input: {
    toolCallId: string;
    resolutionRequestId: string;
    resolution: InteractionResolution;
  }): Promise<void> {
    if (this.hooks.isStopping(input.toolCallId)) return;
    let call = this.options.storage.toolCalls.get(input.toolCallId);
    if (!call) {
      for (const conversation of this.options.storage.conversations.listAll()) {
        const event = this.options.storage.events
          .since(conversation.id, 0)
          .find(
            (event) =>
              event.type === "tool_call_response" &&
              event.payload.toolCallId === input.toolCallId,
          );
        if (event?.type === "tool_call_response") {
          if (
            event.payload.resolutionRequestId === input.resolutionRequestId &&
            JSON.stringify(event.payload.interactionResolution) ===
              JSON.stringify(input.resolution)
          )
            return;
          throw new Error("Tool call already settled with another resolution");
        }
      }
      throw new Error(`Tool call not found: ${input.toolCallId}`);
    }
    if (this.hooks.isStopping(call.id)) return;
    const interaction = call.interaction;
    if (!interaction || interaction.kind !== input.resolution.kind)
      throw new Error("Resolution does not match the pending interaction");
    if (
      interaction.resolutionRequestId &&
      (interaction.resolutionRequestId !== input.resolutionRequestId ||
        JSON.stringify(interaction.resolution) !==
          JSON.stringify(input.resolution))
    )
      throw new Error("Interaction already resolved");
    if (call.state !== "awaiting_input" && call.state !== "awaiting_approval")
      return;
    if (
      input.resolution.kind === "approval" &&
      input.resolution.persistScope &&
      !call.supervision?.suggestedRules.length
    )
      throw new Error("No suggested permission rule to persist");
    call = this.hooks.update(call.id, {
      interaction: {
        ...interaction,
        resolution: input.resolution,
        resolutionRequestId: input.resolutionRequestId,
      } as Interaction,
    });
    if (input.resolution.kind === "approval") {
      if (input.resolution.decision === "deny") {
        await this.hooks.settlement.settle(call, "denied", {
          content: "Approval denied.",
        });
        return;
      }
      if (input.resolution.persistScope) {
        const rule = call.supervision?.suggestedRules[0];
        if (rule === undefined)
          throw new Error("No suggested permission rule to persist");
        const { projectDir, config } = this.options.context(
          call.conversationId,
        );
        // A mode change must not move a planning approval into the coding overlay.
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
        return;
      this.hooks.update(call.id, { state: "ready" });
      // Tool failures settle through the worker's normal failed-outcome path.
      // Only unexpected persistence errors escape that path and need logging.
      void this.hooks.start([call.id]).catch((error) => {
        console.error("Approved tool worker failed:", error);
      });
      return;
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
      if (!controller.signal.aborted)
        await this.hooks.settlement.settle(call, "completed", result);
    } catch (error) {
      if (!controller.signal.aborted)
        await this.hooks.settlement.settle(call, "failed", {
          content: error instanceof Error ? error.message : String(error),
        });
    } finally {
      this.hooks.controllers.delete(call.id);
    }
  }
}
