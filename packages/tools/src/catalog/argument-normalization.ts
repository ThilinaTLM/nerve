import type { ToolDefinition } from "./contracts.js";

/** Apply a tool's one canonical pre-validation argument normalization step. */
export function normalizeToolArguments(
  definition: ToolDefinition,
  raw: unknown,
): Record<string, unknown> {
  return (
    definition.normalizeArguments ? definition.normalizeArguments(raw) : raw
  ) as Record<string, unknown>;
}
