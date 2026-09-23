import { z } from "zod";

export const asyncSubagentToolNames = [
  "subagent_new",
  "subagent_prompt",
  "subagent_list",
  "subagent_status",
  "subagent_stop",
] as const;
export const asyncSubagentToolNameSchema = z.enum(asyncSubagentToolNames);
export type AsyncSubagentToolName = z.infer<typeof asyncSubagentToolNameSchema>;
export const asyncSubagentNameSchema = z.string().trim().min(1).max(80);
export const asyncSubagentStateSchema = z.enum(["idle", "running", "stopping"]);
export const asyncSubagentOutcomeSchema = z.enum([
  "completed",
  "cancelled",
  "failed",
  "interrupted",
]);
export type AsyncSubagentOutcome = z.infer<typeof asyncSubagentOutcomeSchema>;
export const asyncSubagentStatusSchema = z.object({
  id: z.string(),
  name: z.string(),
  state: asyncSubagentStateSchema,
  runId: z.string().optional(),
  outcome: asyncSubagentOutcomeSchema.optional(),
  activeTaskCount: z.number().int().nonnegative(),
  response: z
    .object({
      entryId: z.string(),
      runId: z.string(),
      text: z.string(),
      complete: z.boolean(),
    })
    .optional(),
});
export type AsyncSubagentStatus = z.infer<typeof asyncSubagentStatusSchema>;

/** Durable admission and cancellation fences, independent of live harness objects. */
export const asyncSubagentControlSchema = z.object({
  agentId: z.string(),
  generation: z.number().int().nonnegative(),
  stopped: z.boolean(),
  stopping: z.boolean(),
  reservedRunId: z.string().optional(),
});
export type AsyncSubagentControl = z.infer<typeof asyncSubagentControlSchema>;

export const asyncSubagentCompletionSchema = z.object({
  childId: z.string(),
  runId: z.string(),
  leadId: z.string(),
  conversationId: z.string(),
  outcome: asyncSubagentOutcomeSchema,
  entryId: z.string(),
  generation: z.number().int().nonnegative(),
  createdAt: z.string(),
  deliveredAt: z.string().optional(),
  consumedAt: z.string().optional(),
  wokenAt: z.string().optional(),
  suppressed: z.boolean().default(false),
});
export type AsyncSubagentCompletion = z.infer<
  typeof asyncSubagentCompletionSchema
>;

export function isAsyncSubagentTool(
  name: string,
): name is AsyncSubagentToolName {
  return (asyncSubagentToolNames as readonly string[]).includes(name);
}

/** Capability exclusions, not a replacement for the autonomous permission policy. */
export function isDeveloperChildToolAllowed(name: string): boolean {
  return (
    name !== "ask_user" &&
    name !== "explore" &&
    !name.startsWith("plan_mode_") &&
    !name.startsWith("subagent_")
  );
}

/** A partially disabled group must never leave unmanaged child execution tools. */
export function normalizeAsyncSubagentTools<T extends string>(
  disabled: readonly T[],
): (T | AsyncSubagentToolName)[] {
  return [
    ...new Set<T | AsyncSubagentToolName>([
      ...disabled,
      ...(disabled.some(isAsyncSubagentTool) ? asyncSubagentToolNames : []),
    ]),
  ];
}

export const asyncSubagentAssignmentSchema = z.object({
  runId: z.string(),
  childId: z.string(),
  leadId: z.string(),
  generation: z.number().int().nonnegative(),
  childGeneration: z.number().int().nonnegative(),
});
export type AsyncSubagentAssignment = z.infer<
  typeof asyncSubagentAssignmentSchema
>;
