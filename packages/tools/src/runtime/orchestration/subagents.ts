import {
  subagentToolNames,
  type SubagentToolName,
} from "@nervekit/contracts/tools";
import type { ToolExecutionResult } from "../../execution/execution-context.js";
import { type ToolHandlerRegistry, ToolValidationError } from "../types.js";
import { optionalString, requiredString } from "./args.js";

export type SubagentToolPort = (
  name: SubagentToolName,
  args: Record<string, unknown>,
  identity: unknown,
) => Promise<ToolExecutionResult>;

export function createSubagentHandlers(
  execute: SubagentToolPort,
): ToolHandlerRegistry {
  const handlers: ToolHandlerRegistry = {};
  for (const name of subagentToolNames) {
    handlers[name] = async (args, context) => {
      if (name === "subagent_prompt") validatePrompt(args);
      else if (name === "subagent_stop") validateStop(args);
      else if (args.name !== undefined) requiredString(args.name, "name");
      return execute(name, args, context.identity);
    };
  }
  return handlers;
}

function validatePrompt(args: Record<string, unknown>): void {
  const assignments = args.assignments;
  if (!Array.isArray(assignments) || assignments.length < 1)
    throw new ToolValidationError("assignments must list at least 1 item.");
  for (const [index, item] of assignments.entries()) {
    const record = (item ?? {}) as Record<string, unknown>;
    requiredString(record.name, `assignments[${index}].name`);
    requiredString(record.prompt, `assignments[${index}].prompt`);
    if (record.profile !== undefined)
      requiredString(record.profile, `assignments[${index}].profile`);
  }
  optionalString(args.context);
}

function validateStop(args: Record<string, unknown>): void {
  if (!Array.isArray(args.names) || args.names.length < 1)
    throw new ToolValidationError("names must list at least 1 name.");
  args.names.forEach((name, index) => requiredString(name, `names[${index}]`));
}
