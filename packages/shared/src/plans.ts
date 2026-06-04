import { z } from "zod";

export const planSlugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9._-]{0,79}$/);
export type PlanSlug = z.infer<typeof planSlugSchema>;

export const planReviewStatusSchema = z.enum([
  "pending",
  "accepted",
  "changes_requested",
  "discarded",
  "force_exited",
]);
export type PlanReviewStatus = z.infer<typeof planReviewStatusSchema>;

export const planReviewRecordSchema = z.object({
  id: z.string().startsWith("plan_review_"),
  toolCallId: z.string().startsWith("tool_"),
  agentId: z.string().startsWith("agent_"),
  sessionId: z.string().startsWith("ses_"),
  projectId: z.string().startsWith("proj_"),
  slug: planSlugSchema,
  title: z.string().min(1).optional(),
  summary: z.string().min(1).optional(),
  planPath: z.string().min(1),
  content: z.string().optional(),
  status: planReviewStatusSchema,
  feedback: z.string().optional(),
  requestedAt: z.string().datetime(),
  resolvedAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime(),
});
export type PlanReviewRecord = z.infer<typeof planReviewRecordSchema>;

export const resolvePlanReviewRequestSchema = z.object({
  feedback: z.string().optional(),
});
export type ResolvePlanReviewRequest = z.infer<
  typeof resolvePlanReviewRequestSchema
>;
