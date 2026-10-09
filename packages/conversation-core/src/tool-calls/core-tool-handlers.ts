import type { ConversationConfig } from "@nervekit/contracts/core";
import {
  planReviewRequestSchema,
  userInputRequestSchema,
} from "@nervekit/contracts/core";
import { toolDefinitionByName } from "@nervekit/tools/catalog";
import type { AssetStore } from "../assets/asset-store.js";
import type { CoreToolHandler } from "./core-tool.js";

export interface CoreToolHandlerOptions {
  assets: AssetStore;
  configure(
    conversationId: string,
    patch: Partial<Omit<ConversationConfig, "conversationId">>,
  ): void | Promise<void>;
  // The host decides which plan files can be read; the core owns the reviewed copy.
  readPlan?(input: {
    conversationId: string;
    path: string;
    signal: AbortSignal;
  }): Promise<string>;
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
          request: userInputRequestSchema.parse(call.arguments),
        },
      };
    },
    async resolve(_call, resolution) {
      if (resolution.kind !== "user_input")
        throw new Error("Expected user-input answer");
      return {
        content: JSON.stringify(resolution.answers),
        details: { answers: resolution.answers },
      };
    },
  });
  register("plan_mode_enter", {
    async execute(call) {
      await options.configure(call.conversationId, { mode: "planning" });
      return {
        kind: "completed",
        result: {
          content: "Entered planning mode.",
          details: { mode: "planning" },
        },
      };
    },
  });
  register("plan_mode_force_exit", {
    async execute(call) {
      await options.configure(call.conversationId, { mode: "coding" });
      return {
        kind: "completed",
        result: {
          content: "Exited planning mode.",
          details: { mode: "coding", reason: call.arguments.reason },
        },
      };
    },
  });
  register("plan_mode_present", {
    async execute(call, ctx) {
      const path = call.arguments.file_path;
      if (typeof path !== "string" || !path)
        throw new Error("A plan file_path is required");
      if (!options.readPlan) throw new Error("Plan loading is not configured");
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
            assetId: asset.id,
            path: options.assets.path(asset.logicalPath),
          }),
        },
      };
    },
    async resolve(call, resolution) {
      if (resolution.kind !== "plan_review")
        throw new Error("Expected plan-review decision");
      if (resolution.decision === "approve")
        await options.configure(call.conversationId, { mode: "coding" });
      return {
        content:
          resolution.decision === "approve"
            ? "Plan approved. Entered coding mode."
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
