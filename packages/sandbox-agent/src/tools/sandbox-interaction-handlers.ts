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
        const submitted = options.inputWaiter?.resolutionForRequest(
          current.toolCallId,
        );
        if (submitted?.response?.text === undefined) return undefined;
        return {
          content: redactor.redactText(submitted.response.text),
          details: { requestId: current.toolCallId, status: "submitted" },
        };
      },
      request: async (value, input) => {
        const current = identity(value);
        if (!options.inputWaiter) {
          throw new Error("UNAVAILABLE: input waiter is not configured");
        }
        const wait = await options.inputWaiter.request({
          requestId: current.toolCallId,
          ...current.scope,
          question: { text: input.question },
          context: input.context,
          recommendation: input.recommendation,
          placeholder: input.placeholder,
          redactedDisplay: { text: redactor.redactText(input.question) },
        });
        await options.record(
          {
            toolCallId: current.toolCallId,
            toolName: "ask_user",
            status: "waiting_for_input",
            lifecycleSeq: 2,
          },
          { ...current.context, ...current.scope },
        );
        throw new AgentToolSuspension({
          toolCallId: current.toolCallId,
          toolName: "ask_user",
          reason: `WAITING_FOR_INPUT: ${wait.requestId}`,
        });
      },
    }),
    ...createPlanHandlers({
      enter: async (_value, reason) => {
        if (!options.planReviewWaiter || !options.configStore) {
          throw new Error("UNAVAILABLE: plan mode is not configured");
        }
        const planDir = await options.planReviewWaiter.ensurePlanDir();
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
        const waiter = options.planReviewWaiter;
        if (!waiter) {
          throw new Error("UNAVAILABLE: plan review waiter is not configured");
        }
        const existing = waiter.byProviderToolCallId(current.toolCallId);
        if (existing && existing.status !== "pending") {
          return planReviewResult(existing.review);
        }
        if (existing) {
          throw new AgentToolSuspension({
            toolCallId: current.toolCallId,
            toolName: "plan_mode_present",
            reason: `WAITING_FOR_PLAN_REVIEW: ${existing.review.id}`,
          });
        }
        const review = await waiter.request({
          providerToolCallId: current.toolCallId,
          ...current.scope,
          cwd: options.workspaceDir,
          ...request,
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
