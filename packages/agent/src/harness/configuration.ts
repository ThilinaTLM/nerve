import type { AgentTool } from "../types.js";
import { AgentHarnessError } from "./errors.js";

export function findDuplicateNames(names: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) duplicates.add(name);
    seen.add(name);
  }
  return [...duplicates];
}

export function validateUniqueNames(names: string[], message: string): void {
  const duplicates = findDuplicateNames(names);
  if (duplicates.length > 0)
    throw new AgentHarnessError(
      "invalid_argument",
      `${message}: ${duplicates.join(", ")}`,
    );
}

export function validateToolNames<TTool extends AgentTool>(
  toolNames: string[],
  tools: Map<string, TTool>,
): void {
  validateUniqueNames(toolNames, "Duplicate active tool name(s)");
  const missing = toolNames.filter((name) => !tools.has(name));
  if (missing.length > 0)
    throw new AgentHarnessError(
      "invalid_argument",
      `Unknown tool(s): ${missing.join(", ")}`,
    );
}
