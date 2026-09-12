import { z } from "zod";

export const toolReplayCapabilitySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("safe_repeat_observation"),
    version: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal("contractually_replay_safe_effect"),
    version: z.number().int().positive(),
    externalKeyEncoding: z.string().min(1).max(128),
    externalKeyScope: z.string().min(1).max(256),
    retentionWindowMs: z.number().int().positive(),
    reconciliation: z.enum(["supported", "unsupported"]),
  }),
  z.object({
    kind: z.literal("non_repeatable_or_unknown"),
    version: z.number().int().positive(),
  }),
]);
export type ToolReplayCapability = z.infer<typeof toolReplayCapabilitySchema>;

/**
 * Internal commands settle through Nerve's command receipt and wait-group
 * boundary. They do not authorize an external invocation or effect retry.
 */
export const toolExecutionRecoveryContractSchema = z.discriminatedUnion(
  "executionClass",
  [
    z.object({
      executionClass: z.literal("external_effect"),
      capability: toolReplayCapabilitySchema,
    }),
    z.object({
      executionClass: z.literal("internal_command"),
      version: z.number().int().positive(),
    }),
  ],
);
export type ToolExecutionRecoveryContract = z.infer<
  typeof toolExecutionRecoveryContractSchema
>;
