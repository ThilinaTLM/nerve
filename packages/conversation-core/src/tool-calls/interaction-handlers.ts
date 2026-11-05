import type { InteractionResolution, ToolCall } from "@nervekit/contracts/core";
import {
  InteractionError,
  type InteractionContext,
  type InteractionHandler,
  type InteractionHandlers,
  type InteractionOutcome,
} from "./interaction-handler.js";
import { isProfileTransition, type CoreToolResolution } from "./core-tool.js";
import { effectivePermissionRuleSetId } from "./permission-rule-set.js";

export function sameResolution(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const settle = (
  status: "completed" | "denied" | "cancelled" | "failed",
  content: string,
): InteractionOutcome => ({ kind: "settle", status, result: { content } });

const approvalHandler: InteractionHandler<"approval"> = {
  kind: "approval",
  cancellable: false,
  validate(call, resolution) {
    if (resolution.persistScope && !call.supervision?.suggestedRules.length)
      throw new InteractionError("No suggested permission rule to persist");
  },
  async apply(call, resolution, ctx) {
    if (resolution.decision === "deny")
      return settle("denied", "Approval denied.");
    if (resolution.persistScope) {
      const rule = call.supervision?.suggestedRules[0];
      if (rule === undefined)
        throw new InteractionError("No suggested permission rule to persist");
      const { projectDir, config } = await ctx.options.context(
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
      await ctx.options.permissions.addRule({
        scope: resolution.persistScope,
        conversationId: call.conversationId,
        projectDir,
        ruleSetId,
        rule,
      });
    }
    // After restart there is no transient presentation: never invent a grant.
    const binding = ctx.presentedApproval;
    return {
      kind: "retry",
      patch: {
        state: "ready",
        supervision: call.supervision
          ? { ...call.supervision, ...(binding ? { approval: binding } : {}) }
          : null,
      },
    };
  },
};

const configurationBlockedHandler: InteractionHandler<"configuration_blocked"> =
  {
    kind: "configuration_blocked",
    cancellable: false,
    validate() {},
    async apply(_call, resolution) {
      return resolution.decision === "cancel"
        ? settle(
            "cancelled",
            "Tool call cancelled because execution configuration is blocked.",
          )
        : { kind: "retry", patch: { state: "ready", executionClaim: null } };
    },
  };

/** Tool-specific resolution for kinds that pause inside a core tool. */
async function resolveWithTool(
  call: ToolCall,
  resolution: InteractionResolution,
  ctx: InteractionContext,
): Promise<CoreToolResolution> {
  const handler = ctx.coreTool(call.toolName);
  return handler?.resolve
    ? handler.resolve(call, resolution, ctx.toolContext(call))
    : { content: JSON.stringify(resolution) };
}

const userInputHandler: InteractionHandler<"user_input"> = {
  kind: "user_input",
  cancellable: true,
  validate() {},
  async apply(call, resolution, ctx) {
    const result = await resolveWithTool(call, resolution, ctx);
    if (isProfileTransition(result))
      throw new InteractionError("Unexpected profile transition");
    return { kind: "settle", status: "completed", result };
  },
  async onError(_call, _resolution, error) {
    return settle(
      "failed",
      error instanceof Error ? error.message : String(error),
    );
  },
};

/** Maps a profile transition to an outcome; a refresh reopens the review. */
function transitionOutcome(
  call: ToolCall,
  resolution: CoreToolResolution,
): InteractionOutcome {
  if (!isProfileTransition(resolution))
    throw new InteractionError("Expected profile transition result");
  const { transition } = resolution;
  if (
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
    return {
      kind: "reopen",
      interaction: { kind: "plan_review", request },
      result: transition,
    };
  }
  return { kind: "transition", transition, settle: resolution.result };
}

const planReviewHandler: InteractionHandler<"plan_review"> = {
  kind: "plan_review",
  cancellable: true,
  validate() {},
  async reconcile(call, resolution, ctx) {
    const recorded =
      call.interaction?.kind === "plan_review" ? call.interaction : undefined;
    if (recorded?.resolution?.decision !== "approve") return undefined;
    const resolvedAgain =
      recorded.resolutionRequestId === ctx.resolutionRequestId &&
      sameResolution(recorded.resolution, resolution);
    const handler = ctx.coreTool(call.toolName);
    if (!handler?.recover)
      throw new InteractionError("Plan transition recovery is not configured");
    const outcome = transitionOutcome(
      call,
      await handler.recover(call, ctx.toolContext(call)),
    );
    const refresh = outcome.kind === "reopen";
    return { outcome, proceed: refresh && !resolvedAgain };
  },
  async apply(call, resolution, ctx) {
    const result = await resolveWithTool(call, resolution, ctx);
    return isProfileTransition(result)
      ? transitionOutcome(call, result)
      : { kind: "settle", status: "completed", result };
  },
  async onError(call, resolution, _error, ctx) {
    // Reopen promptly so the review remains actionable after a failed save or
    // SQLite commit. Recovery only previews; it cannot apply or enqueue.
    if (resolution.decision !== "approve") return "rethrow";
    try {
      const handler = ctx.coreTool(call.toolName);
      if (handler?.recover) {
        const outcome = transitionOutcome(
          call,
          await handler.recover(call, ctx.toolContext(call)),
        );
        if (outcome.kind === "reopen") return outcome;
      }
    } catch {
      // Keep accepted state when configuration cannot be refreshed. Reload
      // or explicit retry can reopen it once authority is available.
    }
    return "rethrow";
  },
};

export function createInteractionHandlers(): InteractionHandlers {
  return {
    approval: approvalHandler,
    user_input: userInputHandler,
    plan_review: planReviewHandler,
    configuration_blocked: configurationBlockedHandler,
  };
}
