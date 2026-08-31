import { z } from "zod";
import { definePublicEvent } from "../../events/definition.js";

const runEventCommonSchema = z.object({
  conversationId: z.string().startsWith("conv_"),
  agentId: z.string().startsWith("agent_"),
  runId: z.string().startsWith("run_"),
});

const runWaitingEventSchema = runEventCommonSchema.extend({
  waitKind: z.enum(["user_input", "approval", "plan_review"]),
  interactionId: z.string().min(1),
  toolCallId: z.string().startsWith("tool_"),
  interactionOrdinal: z.number().int().nonnegative().max(15),
  toolCallRevision: z.number().int().positive().safe(),
  createdAt: z.string().datetime(),
});

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
