import { AgentToolSuspension } from "@nervekit/host-runtime/harness";
import {
  createInteractionHandlers,
  createPlanHandlers,
  createTodoHandlers,
  type ToolExecutionResult,
  type ToolHandlerRegistry,
} from "@nervekit/host-runtime/tools";
import type { PlanReviewRecord } from "@nervekit/contracts";
import { Redactor } from "../security/redaction.js";
import {
  type SandboxOrchestrationHandlerOptions,
  sandboxOrchestrationIdentity,
} from "./sandbox-orchestration-types.js";

export function createSandboxInteractionHandlers(
  options: SandboxOrchestrationHandlerOptions,
): ToolHandlerRegistry {
  const redactor = options.redactor ?? new Redactor({ secrets: [] });
  const identity = sandboxOrchestrationIdentity;

  return {
    ...createInteractionHandlers({
      resolve: async (value) => {
        const current = identity(value);
        const resolution = await options.interactions?.resolved(
          current.toolCallId,
        );
        const text = resolution?.text ?? resolution?.answer;
        if (typeof text !== "string") return undefined;
        return {
          content: redactor.redactText(text),
          details: { requestId: current.toolCallId, status: "submitted" },
        };
      },
      request: async (value, input) => {
        const current = identity(value);
        await options.record(
          {
            toolCallId: current.toolCallId,
            toolName: "ask_user",
            status: "waiting_for_input",
            lifecycleSeq: 2,
          },
          { ...current.context, ...current.scope },
        );
        if (!options.interactions) {
          throw new Error(
            "UNAVAILABLE: run interaction port is not configured",
          );
        }
        options.interactions.setPending(current.toolCallId, {
          kind: "question",
          prompt: input.question,
          context: input.context,
          placeholder: input.placeholder,
          required: true,
        });
        throw new AgentToolSuspension({
          toolCallId: current.toolCallId,
          toolName: "ask_user",
          reason: `WAITING_FOR_INPUT: ${current.toolCallId}`,
        });
      },
    }),
    ...createPlanHandlers({
      enter: async (_value, reason) => {
        if (!options.planReviewStore || !options.configStore) {
          throw new Error("UNAVAILABLE: plan mode is not configured");
        }
        const planDir = await options.planReviewStore.ensurePlanDir();
        const alreadyPlanning = options.configStore.read().mode === "planning";
        await options.configStore.update({ mode: "planning" });
        const resolvedReason = reason ?? "Agent entered planning mode.";
        return {
          content: `Plan mode active. Write plans under ${planDir}, then call plan_mode_present with the plan file path.`,
          details: {
            mode: "planning",
            planDir,
            alreadyPlanning,
            reason: resolvedReason,
          },
        };
      },
      present: async (value, request) => {
        const current = identity(value);
        const store = options.planReviewStore;
        if (!store) {
          throw new Error("UNAVAILABLE: plan review store is not configured");
        }
        // The store validates the plan file and builds the record (idempotent
        // by providerToolCallId); it is not run lifecycle authority.
        const review = await store.createReview({
          providerToolCallId: current.toolCallId,
          ...current.scope,
          cwd: options.workspaceDir,
          ...request,
        });
        if (options.interactions) {
          const resolution = await options.interactions.resolved(
            current.toolCallId,
          );
          if (resolution) return planReviewResult(review.review);
          options.interactions.setPending(current.toolCallId, {
            kind: "plan_review",
            interactionId: review.review.id,
            prompt: review.review.title ?? "Review the plan",
            planReview: review.review,
          });
          await options.record(
            {
              toolCallId: current.toolCallId,
              toolName: "plan_mode_present",
              status: "waiting_for_input",
              lifecycleSeq: 2,
              result: planReviewPayload(review.review),
            },
            { ...current.context, ...current.scope },
          );
          throw new AgentToolSuspension({
            toolCallId: current.toolCallId,
            toolName: "plan_mode_present",
            reason: `WAITING_FOR_PLAN_REVIEW: ${review.review.id}`,
          });
        }
        if (review.status !== "pending") {
          return planReviewResult(review.review);
        }
        await options.record(
          {
            toolCallId: current.toolCallId,
            toolName: "plan_mode_present",
            status: "waiting_for_input",
            lifecycleSeq: 2,
            result: planReviewPayload(review.review),
          },
          { ...current.context, ...current.scope },
        );
        throw new AgentToolSuspension({
          toolCallId: current.toolCallId,
          toolName: "plan_mode_present",
          reason: `WAITING_FOR_PLAN_REVIEW: ${review.review.id}`,
        });
      },
      forceExit: async (_value, reason) => {
        if (!options.configStore) {
          throw new Error("UNAVAILABLE: plan mode is not configured");
        }
        await options.configStore.update({ mode: "coding" });
        const resolvedReason = reason ?? "Agent exited planning mode.";
        return {
          content: `Plan mode exited: ${resolvedReason}`,
          details: { mode: "coding", reason: resolvedReason },
        };
      },
    }),
    ...createTodoHandlers({
      get: (value) => options.todoStore.get(identity(value).scope),
      set: (value, todos) =>
        options.todoStore.set(identity(value).scope, todos),
    }),
  };
}

function planReviewPayload(review: PlanReviewRecord): Record<string, unknown> {
  return { review, outcome: review.status, feedback: review.feedback };
}

function planReviewResult(review: PlanReviewRecord): ToolExecutionResult {
  const text =
    review.status === "accepted"
      ? "Plan accepted. Exit planning mode and implement the accepted plan."
      : review.status === "accepted_in_new_chat"
        ? "Plan accepted for implementation in a new conversation."
        : review.status === "changes_requested"
          ? "Plan changes requested. Revise the plan using the feedback and present it again."
          : review.status === "discarded"
            ? "Plan discarded."
            : "Plan is awaiting user review.";
  return { content: text, details: planReviewPayload(review) };
}
