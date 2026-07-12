import { z } from "zod";
import { definePublicEvent } from "../events/event-definition.schema.js";
import { planReviewRecordSchema } from "./plan-review.schema.js";

const planReviewResolvedEventSchema = z.object({
  instanceId: z.string().min(1).optional(),
  sandboxId: z.string().min(1).optional(),
  conversationId: z.string().startsWith("conv_"),
  agentId: z.string().startsWith("agent_"),
  runId: z.string().startsWith("run_"),
  reviewId: z.string().startsWith("plan_review_"),
  decision: z.enum(["accept", "request_changes", "discard"]),
  planReview: planReviewRecordSchema,
  resolvedAt: z.string().datetime(),
});

export const planReviewUpdatedEventSchema = z.union([
  planReviewResolvedEventSchema,
  z.object({ planReview: planReviewRecordSchema }),
  z.object({
    status: z.literal("force_exited"),
    agentId: z.string().startsWith("agent_"),
    conversationId: z.string().startsWith("conv_"),
    projectId: z.string().startsWith("proj_"),
    reason: z.string().min(1).max(4_096),
  }),
]);

export const planEventDefinitions = [
  definePublicEvent("planReview.updated", planReviewUpdatedEventSchema, {
    allowedSourceRoles: ["workbench_server", "sandbox_agent"],
    scope: ["projectId", "conversationId", "agentId", "reviewId"],
  }),
];
