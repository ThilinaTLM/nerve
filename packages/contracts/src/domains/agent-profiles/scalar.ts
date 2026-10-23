import { z } from "zod";

/**
 * Omission keeps the conversation's current value; "settings" resets it to the
 * application settings value (project → user); lead is creation-time copying,
 * never a live layer.
 */
export type AgentProfileSetting<T> =
  | "lead"
  | "settings"
  | { set: T }
  | { lock: T };
export type AgentProfileSettingKind =
  | "use-settings"
  | "settings"
  | "lead"
  | "set"
  | "lock";
export function agentProfileSettingSchema<T extends z.ZodType>(value: T) {
  return z.union([
    z.literal("lead"),
    z.literal("settings"),
    z.object({ set: value }).strict(),
    z.object({ lock: value }).strict(),
  ]);
}
export function agentProfileSettingKind<T>(
  setting?: AgentProfileSetting<T>,
): AgentProfileSettingKind {
  if (setting === undefined) return "use-settings";
  if (setting === "lead" || setting === "settings") return setting;
  return "lock" in setting ? "lock" : "set";
}
/** The explicit Set or Lock value; undefined for value-less modes. */
export function explicitValue<T>(
  setting?: AgentProfileSetting<T>,
): T | undefined {
  if (!setting || typeof setting === "string") return undefined;
  return "lock" in setting ? setting.lock : setting.set;
}
export function lockedValue<T>(
  setting?: AgentProfileSetting<T>,
): T | undefined {
  return setting && typeof setting !== "string" && "lock" in setting
    ? setting.lock
    : undefined;
}
