import type { ToolName } from "@nervekit/contracts";
import { toolDefinitionByName } from "../catalog/manifest.js";
import type { ToolExecutionContext, ToolExecutionResult } from "../types.js";
import { ToolExecutionError } from "./common/tool-error.js";

export async function executeTool(
  name: ToolName,
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const definition = toolDefinitionByName(name);
  if (!definition) {
    throw new ToolExecutionError("UNKNOWN_TOOL", `Unknown tool: ${name}`, {
      toolName: name,
    });
  }
  if (definition.executionKind === "host") {
    throw new ToolExecutionError(
      "HOST_HANDLER_REQUIRED",
      `Tool '${name}' requires a host handler.`,
      { toolName: name },
    );
  }

  const prepared = definition.prepareArguments
    ? definition.prepareArguments(args)
    : args;
  return definition.executor(prepared as Record<string, unknown>, context);
}
