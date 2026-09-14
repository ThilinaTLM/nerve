import { z } from "zod";

export const childExecutionRelationshipSchema = z.object({
  schemaVersion: z.literal(1),
  relationshipId: z.string().startsWith("childrel_"),
  parentAgentId: z.string().startsWith("agent_"),
  parentConversationId: z.string().startsWith("conv_"),
  parentRunId: z.string().startsWith("run_"),
  parentToolCallId: z.string().startsWith("tool_"),
  childAgentId: z.string().startsWith("agent_"),
  childConversationId: z.string().startsWith("conv_"),
  childRunId: z.string().startsWith("run_"),
  state: z.enum(["registered", "running", "completed", "failed", "detached"]),
  resultDigest: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/)
    .optional(),
  errorMessage: z.string().max(4096).optional(),
  revision: z.number().int().positive().safe(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export type ChildExecutionRelationship = z.infer<
  typeof childExecutionRelationshipSchema
>;
