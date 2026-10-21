import { z } from "zod";

/** Inherit from the parent context, set on application, or resolve a lock each turn. */
export type AgentProfileScalar<T> =
  | "inherit"
  | "default"
  | T
  | { lock: T | "default" };
export type AgentProfileScalarKind = "inherit" | "set" | "lock";

export function agentProfileScalarSchema<T extends z.ZodType>(value: T) {
  const setting = z.union([z.literal("default"), value]);
  return z.union([
    z.literal("inherit"),
    setting,
    z.object({ lock: setting }).strict(),
  ]);
}

export function agentProfileScalarKind<T>(
  setting: AgentProfileScalar<T>,
): AgentProfileScalarKind {
  if (setting === "inherit") return "inherit";
  return typeof setting === "object" && setting !== null && "lock" in setting
    ? "lock"
    : "set";
}

/** Undefined means unlocked; `default` remains unresolved for the caller. */
export function lockedValue<T>(
  setting: AgentProfileScalar<T>,
): T | "default" | undefined {
  return typeof setting === "object" && setting !== null && "lock" in setting
    ? setting.lock
    : undefined;
}
