import { z } from "zod";

/** Omission means use current settings; lead is creation-time copying, never a live layer. */
export type AgentProfileSetting<T> = "lead" | { set: T } | { lock: T };
export type AgentProfileSettingKind = "use-settings" | "lead" | "set" | "lock";
export function agentProfileSettingSchema<T extends z.ZodType>(value: T) {
  return z.union([
    z.literal("lead"),
    z.object({ set: value }).strict(),
    z.object({ lock: value }).strict(),
  ]);
}
export function agentProfileSettingKind<T>(
  setting?: AgentProfileSetting<T>,
): AgentProfileSettingKind {
  if (setting === undefined) return "use-settings";
  if (setting === "lead") return "lead";
  return "lock" in setting ? "lock" : "set";
}
export function lockedValue<T>(
  setting?: AgentProfileSetting<T>,
): T | undefined {
  return setting && setting !== "lead" && "lock" in setting
    ? setting.lock
    : undefined;
}
