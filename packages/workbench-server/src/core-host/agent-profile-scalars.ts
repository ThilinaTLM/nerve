import { isDeepStrictEqual } from "node:util";
import {
  agentProfileScalarKind,
  lockedValue,
  type AgentProfileScalar,
} from "@nervekit/contracts/agent-profiles";

export function scalarValue<T>(
  value: AgentProfileScalar<T>,
): T | "inherit" | "default" {
  return lockedValue(value) ?? (value as T | "inherit" | "default");
}
export function resolveProfileScalar<T>(
  value: AgentProfileScalar<T>,
  inherited: T,
  fallback: T,
): T {
  const setting = scalarValue(value);
  return setting === "inherit"
    ? inherited
    : setting === "default"
      ? fallback
      : setting;
}
export function switchScalar<T>(
  previous: AgentProfileScalar<T> | undefined,
  next: AgentProfileScalar<T>,
  stored: T,
  fallback: T,
): T | undefined {
  if (agentProfileScalarKind(next) === "lock") return undefined;
  if (next !== "inherit") return resolveProfileScalar(next, stored, fallback);
  if (
    previous !== undefined &&
    agentProfileScalarKind(previous) === "set" &&
    isDeepStrictEqual(stored, resolveProfileScalar(previous, stored, fallback))
  )
    return fallback;
  return stored;
}
