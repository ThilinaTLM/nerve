import { z } from "zod";
import { agentInputNoticeSchema } from "./agent-input-notice.js";
import { promptImageSchema } from "./prompt.js";
import { agentConfigurationSchema } from "./agent.js";
import { modelSelectionSchema, thinkingLevelSchema } from "../models/models.js";
import { permissionRuleSetIdSchema } from "../permissions/permission-rule-sets.js";
import {
  exploreUsageStatsSchema,
  exploreStepSchema,
} from "../tools/tool-results.js";

const agentId = z.string().startsWith("agent_");
const runId = z.string().startsWith("run_");
export const agentInputOriginSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), userId: z.string().min(1) }),
  z.object({ kind: z.literal("parent"), agentId, runId: runId.optional() }),
  z.object({
    kind: z.literal("system"),
    producer: z.string().min(1),
    correlationId: z.string().min(1),
  }),
]);
export const agentInputEligibilitySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("next_turn") }),
  z.object({ kind: z.literal("next_run"), afterRunId: runId.optional() }),
  z.object({ kind: z.literal("run"), runId }),
]);
export const agentInputActivationSchema = z.enum([
  "wake_if_idle",
  "queue_only",
]);
const inputRequest = z.object({
  agentId,
  conversationId: z.string().startsWith("conv_"),
  idempotencyKey: z.string().min(1).max(256),
  origin: agentInputOriginSchema,
  role: z.enum(["user", "system"]),
  text: z.string().min(1),
  notice: agentInputNoticeSchema.optional(),
  images: z.array(promptImageSchema).max(16).optional(),
  eligibility: agentInputEligibilitySchema.default({ kind: "next_turn" }),
  activation: agentInputActivationSchema.default("wake_if_idle"),
});
function validateRole(
  value: z.infer<typeof inputRequest>,
  context: z.RefinementCtx,
): void {
  if (
    value.notice &&
    (value.role !== "system" || value.origin.kind !== "system")
  ) {
    context.addIssue({
      code: "custom",
      path: ["notice"],
      message: "Only authenticated system inputs may carry notice metadata.",
    });
  }
  if (value.role === "system" && value.origin.kind !== "system") {
    context.addIssue({
      code: "custom",
      path: ["role"],
      message:
        "Only authenticated system producers may submit system-role input.",
    });
  }
}
export const acceptAgentInputRequestSchema =
  inputRequest.superRefine(validateRole);
export type AcceptAgentInputRequest = z.infer<
  typeof acceptAgentInputRequestSchema
>;
export const agentInputRecordSchema = inputRequest
  .extend({
    id: z.string().min(1),
    sequence: z.number().int().nonnegative(),
    acceptedAt: z.string().datetime(),
    state: z.enum(["pending", "delivered", "cancelled", "obsolete"]),
    preparation: z.enum(["preparing", "ready"]).optional(),
    interruptionRequested: z.boolean().optional(),
    delivery: z
      .object({
        runId,
        attemptId: z.string().min(1),
        turnId: z.string().min(1),
        contextEntryId: z.string().min(1),
        deliveredAt: z.string().datetime(),
      })
      .optional(),
  })
  .superRefine((value, context) => {
    validateRole(value, context);
    if ((value.state === "delivered") !== Boolean(value.delivery)) {
      context.addIssue({
        code: "custom",
        path: ["delivery"],
        message: "Delivery identity is required exactly for delivered input.",
      });
    }
    if (
      value.delivery &&
      value.eligibility.kind === "run" &&
      value.delivery.runId !== value.eligibility.runId
    ) {
      context.addIssue({
        code: "custom",
        path: ["delivery", "runId"],
        message: "Run-targeted input cannot be delivered to a replacement run.",
      });
    }
  });
export type AgentInputRecord = z.infer<typeof agentInputRecordSchema>;
export type AgentInput = AgentInputRecord;
/** Resolved invocation settings, never the raw nullable inheritance selections. */
export const resolvedAgentConfigurationSchema = agentConfigurationSchema.extend(
  {
    model: modelSelectionSchema,
    permissionRuleSetId: permissionRuleSetIdSchema,
    systemPrompt: z.string(),
    tools: z.array(z.string().min(1)),
    skills: z.array(z.string().min(1)),
  },
);
export type ResolvedAgentConfiguration = z.infer<
  typeof resolvedAgentConfigurationSchema
>;
const turnIdentity = z.object({
  agentId,
  runId,
  attemptId: z.string().min(1),
  turnId: z.string().min(1),
  configurationRevision: z.number().int().positive(),
});
/** Existing accepted-only histories remain readable without claiming resolved provenance. */
export const effectiveTurnConfigurationSchema = z.union([
  turnIdentity.extend({
    configurationProvenance: z.literal("resolved"),
    acceptedConfiguration: agentConfigurationSchema,
    configuration: resolvedAgentConfigurationSchema,
    permissionPolicyHash: z.string().min(1).optional(),
  }),
  turnIdentity.extend({
    configurationProvenance: z
      .literal("legacy_accepted")
      .default("legacy_accepted"),
    configuration: agentConfigurationSchema,
  }),
]);
export type EffectiveTurnConfiguration = z.infer<
  typeof effectiveTurnConfigurationSchema
>;
export const agentCompletionSchema = z
  .object({
    agentId,
    runId,
    /** Actual terminal attempt, not the original submission when automatic retry occurred. */
    attemptId: z.string().min(1),
    submittedAttemptId: z.string().min(1).optional(),
    usage: exploreUsageStatsSchema.optional(),
    model: z.string().optional(),
    modelSelection: modelSelectionSchema.optional(),
    thinkingLevel: thinkingLevelSchema.optional(),
    steps: z.array(exploreStepSchema).optional(),
    stopReason: z.string().optional(),
    outcome: z.enum(["completed", "cancelled", "failed", "interrupted"]),
    completedAt: z.string().datetime(),
    response: z
      .object({
        entryId: z.string().min(1),
        runId,
        text: z.string(),
        complete: z.boolean(),
      })
      .optional(),
    reportPath: z.string().optional(),
  })
  .superRefine((value, context) => {
    if (value.response && value.response.runId !== value.runId)
      context.addIssue({
        code: "custom",
        path: ["response", "runId"],
        message: "Completion response must belong to the exact submitted run.",
      });
  });
export type AgentCompletion = z.infer<typeof agentCompletionSchema>;

/** A completion is one immutable settlement, including optional reporting metadata. */
export function assertAgentCompletionReplacement(
  previous: AgentCompletion,
  replacement: AgentCompletion,
): void {
  if (
    JSON.stringify(agentCompletionSchema.parse(previous)) !==
    JSON.stringify(agentCompletionSchema.parse(replacement))
  ) {
    throw new Error("Agent correlated completion is immutable");
  }
}
