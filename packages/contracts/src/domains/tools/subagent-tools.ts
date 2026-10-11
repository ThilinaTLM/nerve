import { z } from "zod";
import { userConfigurableToolNameSchema } from "./tool-name.js";

export const subagentToolNames = [
  "subagent_prompt",
  "subagent_status",
  "subagent_stop",
] as const;
export const subagentToolNameSchema = z.enum(subagentToolNames);
export type SubagentToolName = z.infer<typeof subagentToolNameSchema>;
export const subagentStateSchema = z.enum(["idle", "running", "stopping"]);
export const subagentOutcomeSchema = z.enum([
  "completed",
  "cancelled",
  "failed",
  "interrupted",
]);
export type SubagentOutcome = z.infer<typeof subagentOutcomeSchema>;
export function isSubagentTool(name: string): name is SubagentToolName {
  return (subagentToolNames as readonly string[]).includes(name);
}

/** Tool names removed by sub-agent profiles; stored disabled lists may still carry them. */
const legacySubagentToolNames = ["subagent_new", "subagent_list"] as const;
const legacyRemovedToolNames = ["explore"] as const;

/**
 * Disabled-tool list as stored or submitted. Accepts removed legacy names and
 * normalizes them: legacy sub-agent tools disable the whole group, `explore` is dropped.
 */
export const disabledToolListSchema = z
  .array(
    z.enum([
      ...userConfigurableToolNameSchema.options,
      ...legacySubagentToolNames,
      ...legacyRemovedToolNames,
    ]),
  )
  .transform(normalizeSubagentTools);

/** A partially disabled group must never leave unmanaged child execution tools. */
export function normalizeSubagentTools<T extends string>(
  disabled: readonly T[],
): Exclude<
  T,
  | (typeof legacySubagentToolNames)[number]
  | (typeof legacyRemovedToolNames)[number]
>[] {
  const legacy: readonly string[] = legacySubagentToolNames;
  const removed: readonly string[] = legacyRemovedToolNames;
  const kept = disabled.filter((name) => !removed.includes(name));
  const groupDisabled = kept.some(
    (name) => isSubagentTool(name) || legacy.includes(name),
  );
  return [
    ...new Set<string>([
      ...kept.filter((name) => !legacy.includes(name)),
      ...(groupDisabled ? subagentToolNames : []),
    ]),
  ] as never;
}
