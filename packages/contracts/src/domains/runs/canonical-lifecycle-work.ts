import { z } from "zod";

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const canonicalLifecycleWorkSchema = z
  .object({
    schemaVersion: z.literal(1),
    workId: z.string().startsWith("canonical_work_"),
    conversationId: z.string().startsWith("conv_"),
    runId: z.string().startsWith("run_"),
    kind: z.enum([
      "prepare_provider_request",
      "claim_provider_attempt",
      "dispatch_provider_attempt",
      "claim_tool_attempt",
      "dispatch_tool_attempt",
      "reconcile_execution",
    ]),
    providerPhaseId: z.string().startsWith("provider_phase_").optional(),
    effectId: z.string().startsWith("effect_").optional(),
    attemptId: z.string().startsWith("attempt_").optional(),
    executionClaimId: z.string().startsWith("claim_").optional(),
    state: z.enum([
      "ready",
      "leased",
      "settled",
      "cancelled",
      "recovery_required",
    ]),
    inputHash: digest,
    generation: z.number().int().nonnegative().safe(),
    revision: z.number().int().positive().safe(),
    notBefore: z.string().datetime(),
    leaseOwner: z.string().min(1).max(256).optional(),
    leaseDeadline: z.string().datetime().optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .superRefine((work, context) => {
    const providerWork =
      work.kind === "prepare_provider_request" ||
      work.kind === "claim_provider_attempt" ||
      work.kind === "dispatch_provider_attempt";
    if (providerWork !== Boolean(work.providerPhaseId)) {
      context.addIssue({
        code: "custom",
        path: ["providerPhaseId"],
        message: "Provider work requires exactly one provider phase binding.",
      });
    }
    if (
      (work.kind === "claim_tool_attempt" ||
        work.kind === "dispatch_tool_attempt") &&
      !work.effectId
    ) {
      context.addIssue({
        code: "custom",
        path: ["effectId"],
        message: "Tool dispatch work requires an effect binding.",
      });
    }
    const dispatch = work.kind.startsWith("dispatch_");
    if (dispatch !== Boolean(work.attemptId && work.executionClaimId)) {
      context.addIssue({
        code: "custom",
        path: ["executionClaimId"],
        message:
          "Dispatch work requires an authoritative attempt and execution claim.",
      });
    }
    if (work.state === "leased" && (!work.leaseOwner || !work.leaseDeadline)) {
      context.addIssue({
        code: "custom",
        path: ["leaseOwner"],
        message: "Leased work requires an owner and deadline.",
      });
    }
    if (work.state !== "leased" && (work.leaseOwner || work.leaseDeadline)) {
      context.addIssue({
        code: "custom",
        path: ["leaseOwner"],
        message: "Only leased work may retain scheduler lease metadata.",
      });
    }
  });

export type CanonicalLifecycleWork = z.infer<
  typeof canonicalLifecycleWorkSchema
>;
