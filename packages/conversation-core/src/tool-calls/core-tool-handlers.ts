import type {
  ProfileLifecyclePort,
  ProfileTransitionInput,
} from "../configuration.js";
import { basename } from "node:path";
import type {
  ProfileRefreshRequired,
  ProfileTransitionResult,
} from "@nervekit/contracts/agent-configuration";
import type { UserInputAnswer } from "@nervekit/contracts/core";
import {
  planReviewRequestSchema,
  normalizeUserInputRequest,
} from "@nervekit/contracts/core";
import type { AskUserResult } from "@nervekit/contracts/tools";
import { toolDefinitionByName } from "@nervekit/tools/catalog";
import type { AssetStore } from "../assets/asset-store.js";
import type { CoreToolHandler } from "./core-tool.js";

export interface CoreToolHandlerOptions {
  assets: AssetStore;
  profiles: ProfileLifecyclePort;
  planApprovalProfile?(
    conversationId: string,
    requestCaptureId?: string,
  ): Promise<string>;
  onPlanRejected(conversationId: string): void;
  // The host decides which plan files can be read; the core owns the reviewed copy.
  readPlan?(input: {
    conversationId: string;
    path: string;
    signal: AbortSignal;
  }): Promise<string>;
}

function normalizeAnswer(
  value: string | string[] | UserInputAnswer | undefined,
): UserInputAnswer | undefined {
  const answer =
    typeof value === "string"
      ? { text: value }
      : Array.isArray(value)
        ? {
            text: value
              .map((part) => part.trim())
              .filter(Boolean)
              .join(", "),
          }
        : value;
  const option = answer?.option?.trim();
  const text = answer?.text?.trim();
  return option || text
    ? { ...(option ? { option } : {}), ...(text ? { text } : {}) }
    : undefined;
}

export function createCoreToolHandlers(
  options: CoreToolHandlerOptions,
): Map<string, CoreToolHandler> {
  const handlers = new Map<string, CoreToolHandler>();
  const refreshConfirmation = async (
    conversationId: string,
    profile: string,
    reason: ProfileRefreshRequired["reason"],
  ): Promise<ProfileTransitionResult> => {
    const preview = await options.profiles.preview(conversationId, profile);
    return preview.status === "ready"
      ? {
          status: "refresh_required",
          reason,
          diagnostics: [],
          preview: preview.preview,
        }
      : preview;
  };
  const register = (
    name: string,
    handler: Omit<CoreToolHandler, "definition">,
  ) => {
    const definition = toolDefinitionByName(name);
    if (!definition) throw new Error(`Missing core tool definition: ${name}`);
    handlers.set(name, { definition, ...handler });
  };
  register("ask_user", {
    async execute(call) {
      return {
        kind: "awaiting_input",
        interaction: {
          kind: "user_input",
          request: normalizeUserInputRequest(call.arguments),
        },
      };
    },
    async resolve(call, resolution) {
      if (resolution.kind !== "user_input")
        throw new Error("Expected user-input answer");
      const request = normalizeUserInputRequest(
        call.interaction?.kind === "user_input"
          ? call.interaction.request
          : call.arguments,
      );
      const result: AskUserResult = {
        questions: request.questions.map(({ id, question }) => {
          const answer = resolution.dismissed
            ? undefined
            : normalizeAnswer(resolution.answers[id]);
          return {
            id,
            question,
            ...(answer ? { answer } : { skipped: true as const }),
          };
        }),
        ...(resolution.dismissed ? { dismissed: true } : {}),
      };
      return { content: JSON.stringify(result) };
    },
  });
  register("plan_present", {
    async execute(call, ctx) {
      const path = call.arguments.file_path;
      if (typeof path !== "string" || !path)
        throw new Error("A plan file_path is required");
      if (!options.readPlan) throw new Error("Plan loading is not configured");
      if (!options.planApprovalProfile)
        throw new Error("Plan approval profile is not configured");
      const approvalProfile = await options.planApprovalProfile(
        call.conversationId,
        ctx.requestCaptureId,
      );
      const preview = await options.profiles.preview(
        call.conversationId,
        approvalProfile,
      );
      if (preview.status !== "ready")
        return {
          kind: "awaiting_input",
          interaction: {
            kind: "configuration_blocked",
            request: {
              diagnostics: preview.diagnostics.length
                ? preview.diagnostics
                : [
                    {
                      scope: "conversation",
                      scopeId: call.conversationId,
                      document: "agent",
                      path: "config/agent.json",
                      code: "profile-unavailable",
                      pointer: "/appliedProfile",
                      affectedCapability: "plan-review",
                      recoveryChoices: ["retry", "reload"],
                    },
                  ],
            },
          },
        };
      const content = await options.readPlan({
        conversationId: call.conversationId,
        path,
        signal: ctx.signal,
      });
      if (ctx.signal.aborted) throw new DOMException("Cancelled", "AbortError");
      const asset = await options.assets.write({
        conversationId: call.conversationId,
        toolCallId: call.id,
        category: "plan",
        logicalPath: `conversations/${call.conversationId}/tool-calls/${call.id}/plan.md`,
        content,
        mediaType: "text/markdown",
      });
      return {
        kind: "awaiting_input",
        interaction: {
          kind: "plan_review",
          request: planReviewRequestSchema.parse({
            targetProfile: preview.preview.targetProfile,
            expectedRevision: preview.preview.expectedRevision,
            expectedDigest: preview.preview.expectedDigest,
            assetId: asset.id,
            path: options.assets.path(asset.logicalPath),
            title: basename(path),
            summary: content
              .split(/\r?\n/)
              .slice(0, 6)
              .join("\n")
              .trim()
              .slice(0, 2_000),
            content,
          }),
        },
      };
    },
    async resolve(call, resolution) {
      if (resolution.kind !== "plan_review")
        throw new Error("Expected plan-review decision");
      if (resolution.decision === "approve") {
        if (call.interaction?.kind !== "plan_review")
          throw new Error("Missing captured plan review");
        const confirmation = resolution.confirmation;
        const request = call.interaction.request;
        if (request.content === undefined)
          throw new Error(
            "Captured plan content is unavailable; present the plan again.",
          );
        const input: ProfileTransitionInput = {
          ...confirmation,
          conversationId: call.conversationId,
          kind: "plan-approval",
          toolCallId: call.id,
        };
        const mismatch =
          confirmation.targetProfile.name !== request.targetProfile.name ||
          confirmation.targetProfile.digest !== request.targetProfile.digest
            ? "target_changed"
            : confirmation.expectedRevision !== request.expectedRevision ||
                confirmation.expectedDigest !== request.expectedDigest
              ? "configuration_changed"
              : undefined;
        const transition = mismatch
          ? await refreshConfirmation(
              call.conversationId,
              request.targetProfile.name,
              mismatch,
            )
          : await options.profiles.apply(input);
        return {
          kind: "profile_transition",
          transition,
          result: {
            content: "Plan approved.",
            details: {
              decision: "approve",
              feedback: resolution.feedback,
            },
          },
        };
      } else options.onPlanRejected(call.conversationId);
      return {
        content: `Plan rejected.${resolution.feedback ? ` ${resolution.feedback}` : ""}`,
        details: {
          decision: resolution.decision,
          feedback: resolution.feedback,
        },
      };
    },
    async recover(call) {
      const resolution =
        call.interaction?.kind === "plan_review"
          ? call.interaction.resolution
          : undefined;
      if (resolution?.decision !== "approve")
        throw new Error("No accepted plan approval to refresh");
      const transition = await refreshConfirmation(
        call.conversationId,
        resolution.confirmation.targetProfile.name,
        "configuration_changed",
      );
      return {
        kind: "profile_transition",
        transition,
        result: {
          content: "Plan approved.",
          details: {
            decision: "approve",
            feedback: resolution.feedback,
          },
        },
      };
    },
  });
  return handlers;
}
