import { z } from "zod";
import { defineOperation } from "../protocol/operation-definition.schema.js";
import { promptImageSchema } from "./agent.schema.js";

const agentIdSchema = z.string().startsWith("agent_");
const conversationIdSchema = z.string().startsWith("conv_");
const runIdSchema = z.string().startsWith("run_");
const runScopeSchema = z.object({
  agentId: agentIdSchema.optional(),
  conversationId: conversationIdSchema.optional(),
  runId: runIdSchema.optional(),
});

const promptContentSchema = z.object({
  text: z.string().min(1),
  images: z.array(promptImageSchema).max(16).optional(),
});

export const runStartParamsSchema = runScopeSchema
  .omit({ runId: true })
  .merge(promptContentSchema);
export const runSteerParamsSchema = runScopeSchema
  .required({ agentId: true })
  .merge(promptContentSchema);
export const runFollowUpParamsSchema = runScopeSchema
  .required({ agentId: true })
  .merge(promptContentSchema);
export const runContinueParamsSchema = runScopeSchema
  .required({ runId: true })
  .extend({
    reason: z
      .enum(["after_input", "after_approval", "retry_error", "manual"])
      .optional(),
  });
export const runCancelParamsSchema = runScopeSchema
  .extend({ reason: z.string().min(1).max(1_024).optional() })
  .superRefine((value, context) => {
    if (value.agentId || value.runId) return;
    context.addIssue({
      code: "custom",
      message: "run.cancel requires agentId or runId",
    });
  });

export const runAcceptedResultSchema = z.object({
  accepted: z.literal(true),
  conversationId: conversationIdSchema.optional(),
  agentId: agentIdSchema.optional(),
  runId: runIdSchema.optional(),
  status: z
    .enum([
      "accepted",
      "queued",
      "running",
      "retrying",
      "suspended",
      "waiting",
      "completed",
      "failed",
      "cancelled",
    ])
    .optional(),
});

const hostRoles = ["workbench_server", "sandbox_agent"] as const;

export const runOperationDefinitions = [
  defineOperation(
    "run.start",
    runStartParamsSchema,
    runAcceptedResultSchema,
    "accepted_async",
    "required",
    hostRoles,
    "operation.run.start",
  ),
  defineOperation(
    "run.steer",
    runSteerParamsSchema,
    runAcceptedResultSchema,
    "accepted_async",
    "required",
    hostRoles,
    "operation.run.steer",
  ),
  defineOperation(
    "run.followUp",
    runFollowUpParamsSchema,
    runAcceptedResultSchema,
    "accepted_async",
    "required",
    hostRoles,
    "operation.run.followUp",
  ),
  defineOperation(
    "run.continue",
    runContinueParamsSchema,
    runAcceptedResultSchema,
    "accepted_async",
    "required",
    hostRoles,
    "operation.run.continue",
  ),
  defineOperation(
    "run.cancel",
    runCancelParamsSchema,
    runAcceptedResultSchema,
    "mutation",
    "required",
    hostRoles,
    "operation.run.cancel",
  ),
] as const;

export type RunStartParams = z.infer<typeof runStartParamsSchema>;
export type RunSteerParams = z.infer<typeof runSteerParamsSchema>;
export type RunFollowUpParams = z.infer<typeof runFollowUpParamsSchema>;
export type RunContinueParams = z.infer<typeof runContinueParamsSchema>;
export type RunCancelParams = z.infer<typeof runCancelParamsSchema>;
export type RunAcceptedResult = z.infer<typeof runAcceptedResultSchema>;
