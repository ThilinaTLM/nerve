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
export function isAsyncSubagentTool(
  name: string,
): name is AsyncSubagentToolName {
  return (asyncSubagentToolNames as readonly string[]).includes(name);
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
