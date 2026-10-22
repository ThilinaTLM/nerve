import { basename } from "node:path";
import type {
  ConversationConfig,
  UserInputAnswer,
} from "@nervekit/contracts/core";
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
  setAgentProfile(
    conversationId: string,
    profile: string,
    overrides?: Partial<Pick<ConversationConfig, "model" | "reasoningLevel">>,
  ): Promise<unknown>;
  planApprovalProfile?(conversationId: string): Promise<string>;
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
      );
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
            approvalProfile,
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
        await options.setAgentProfile(
          call.conversationId,
          call.interaction.request.approvalProfile,
          {
            ...(resolution.implementationModel
              ? { model: resolution.implementationModel }
              : {}),
            ...(resolution.implementationThinkingLevel
              ? { reasoningLevel: resolution.implementationThinkingLevel }
              : {}),
          },
        );
      } else options.onPlanRejected(call.conversationId);
      return {
        content:
          resolution.decision === "approve"
            ? "Plan approved. Switched to the implementation profile."
            : `Plan rejected.${resolution.feedback ? ` ${resolution.feedback}` : ""}`,
        details: {
          decision: resolution.decision,
          feedback: resolution.feedback,
        },
      };
    },
  });
  return handlers;
}
