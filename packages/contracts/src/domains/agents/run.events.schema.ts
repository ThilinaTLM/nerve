import { z } from "zod";
import { boundedPublicJsonSchema } from "../events/bounded-public-data.schema.js";
import { definePublicEvent } from "../events/event-definition.schema.js";
import { planReviewRecordSchema } from "../plans/plan-review.schema.js";

const runEventCommonSchema = z.object({
  conversationId: z.string().startsWith("conv_"),
  agentId: z.string().startsWith("agent_"),
  runId: z.string().startsWith("run_"),
});

const runWaitingEventSchema = z.discriminatedUnion("waitKind", [
  runEventCommonSchema.extend({
    waitKind: z.literal("input"),
    requestId: z.string().min(1),
    question: z.object({
      text: z.string(),
      truncated: z.boolean().optional(),
      bytes: z.number().int().nonnegative().safe().optional(),
    }),
    placeholder: z.string().optional(),
    required: z.boolean(),
    createdAt: z.string().datetime(),
  }),
  runEventCommonSchema.extend({
    waitKind: z.literal("approval"),
    approvalId: z.string().min(1),
    toolCallId: z.string().min(1),
    risk: z.array(z.string().min(1)),
    reason: z.string().min(1),
    normalizedArgs: boundedPublicJsonSchema,
    offeredScopes: z
      .array(z.enum(["single_call", "same_tool_same_args", "run"]))
      .optional(),
    createdAt: z.string().datetime(),
  }),
  runEventCommonSchema.extend({
    waitKind: z.literal("plan_review"),
    reviewId: z.string().startsWith("plan_review_"),
    toolCallId: z.string().min(1),
    planReview: planReviewRecordSchema,
    createdAt: z.string().datetime(),
  }),
]);

const runCheckpointedEventSchema = runEventCommonSchema.extend({
  checkpointId: z.string().min(1),
  status: z.enum([
    "queued",
    "running",
    "waiting_for_input",
    "waiting_for_approval",
    "completed",
    "failed",
    "recoverable_failed",
    "cancelled",
  ]),
  checkpointedAt: z.string().datetime(),
});

const scope = ["conversationId", "agentId", "runId"] as const;

export const runEventDefinitions = [
  definePublicEvent("run.waiting", runWaitingEventSchema, { scope }),
  definePublicEvent("run.checkpointed", runCheckpointedEventSchema, { scope }),
];
