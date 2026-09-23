import {
  asyncSubagentToolNames,
  type AsyncSubagentToolName,
} from "@nervekit/contracts/agents";
import type { ToolExecutionResult } from "../../execution/execution-context.js";
import { type ToolHandlerRegistry, ToolValidationError } from "../types.js";
import { requiredString } from "./args.js";

export type SubagentToolPort = (
  name: AsyncSubagentToolName,
  args: Record<string, unknown>,
  identity: unknown,
) => Promise<ToolExecutionResult>;
export function createSubagentHandlers(
  execute: SubagentToolPort,
): ToolHandlerRegistry {
  const handlers: ToolHandlerRegistry = {};
  for (const name of asyncSubagentToolNames) {
    handlers[name] = async (args, context) => {
      if (name === "subagent_new") requiredString(args.name, "name");
      else if (name !== "subagent_list") requiredString(args.id, "id");
      if (name === "subagent_prompt") requiredString(args.prompt, "prompt");
      if (
        name === "subagent_list" &&
        args.limit !== undefined &&
        (!Number.isInteger(args.limit) ||
          Number(args.limit) < 1 ||
          Number(args.limit) > 100)
      )
        throw new ToolValidationError(
          "limit must be an integer between 1 and 100.",
        );
      return execute(name, args, context.identity);
    };
  }
  return handlers;
}
