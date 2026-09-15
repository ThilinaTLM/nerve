import { z } from "zod";

export const childExecutionRelationshipSchema = z.object({
  schemaVersion: z.literal(1),
  relationshipId: z.string().startsWith("childrel_"),
  parentAgentId: z.string().startsWith("agent_"),
  parentConversationId: z.string().startsWith("conv_"),
  parentRunId: z.string().startsWith("run_"),
  parentToolCallId: z.string().startsWith("tool_"),
  parentWaitGroupId: z.string().startsWith("wait_group_").optional(),
  parentMemberId: z.string().startsWith("member_").optional(),
  registrationRevision: z.number().int().positive().safe().optional(),
  registeredParentHeadId: z.string().startsWith("entry_").nullable().optional(),
  registeredParentSelectionEpoch: z
    .number()
    .int()
    .nonnegative()
    .safe()
    .optional(),
  childAgentId: z.string().startsWith("agent_"),
  childConversationId: z.string().startsWith("conv_"),
  childRunId: z.string().startsWith("run_"),
  state: z.enum([
    "registered",
    "running",
    "completed",
    "failed",
    "cancelled",
    "detached",
  ]),
  dispatchEvidence: z
    .enum(["not_dispatched", "dispatch_started", "possibly_dispatched"])
    .optional(),
  terminalOutcome: z.enum(["completed", "failed", "cancelled"]).optional(),
  attachmentState: z
    .enum(["pending", "attached", "detached", "unknown"])
    .optional(),
  attachmentEntryId: z.string().startsWith("entry_").optional(),
  attachmentTransitionId: z.string().startsWith("transition_").optional(),
  cancellationRequestedAt: z.string().datetime({ offset: true }).optional(),
  nonDispatchProvenAt: z.string().datetime({ offset: true }).optional(),
  resultArtifactManifestId: z.string().startsWith("manifest_").optional(),
  resultDigest: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/)
    .optional(),
  resultText: z.string().max(1_000_000).optional(),
  dispatchStartedAt: z.string().datetime({ offset: true }).optional(),
  errorMessage: z.string().max(4096).optional(),
  revision: z.number().int().positive().safe(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export type ChildExecutionRelationship = z.infer<
  typeof childExecutionRelationshipSchema
>;
