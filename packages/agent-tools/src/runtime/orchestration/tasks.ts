import type { ToolName } from "@nervekit/contracts";
import type { ToolExecutionResult } from "../../types.js";
import { type ToolHandlerRegistry, ToolValidationError } from "../types.js";
import { parseTaskSelector, requiredString } from "./args.js";

export type TaskToolName = Extract<ToolName, `task_${string}`>;

export type TaskToolPort = {
  execute(
    name: TaskToolName,
    args: Record<string, unknown>,
    identity: unknown,
    signal?: AbortSignal,
  ): Promise<ToolExecutionResult>;
};

function validateTaskArgs(
  name: TaskToolName,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (name === "task_start") {
    const hasCommand =
      typeof args.command === "string" && args.command.trim().length > 0;
    const hasTasks = Array.isArray(args.tasks) && args.tasks.length > 0;
    if (hasCommand === hasTasks) {
      throw new ToolValidationError(
        "task_start requires exactly one command or a non-empty tasks batch.",
      );
    }
    if (Array.isArray(args.tasks) && args.tasks.length > 8) {
      throw new ToolValidationError("task_start accepts at most 8 tasks.");
    }
  } else if (name === "task_restart") {
    requiredString(args.taskId, "taskId");
  } else if (name === "task_cancel" || name === "task_logs") {
    parseTaskSelector(args);
  }
  return args;
}

export function createTaskHandlers(port: TaskToolPort): ToolHandlerRegistry {
  const handler =
    (name: TaskToolName) =>
    async (
      args: Record<string, unknown>,
      context: { identity?: unknown; signal?: AbortSignal },
    ) =>
      port.execute(
        name,
        validateTaskArgs(name, args),
        context.identity,
        context.signal,
      );

  return {
    task_start: handler("task_start"),
    task_status: handler("task_status"),
    task_logs: handler("task_logs"),
    task_cancel: handler("task_cancel"),
    task_restart: handler("task_restart"),
    task_list: handler("task_list"),
  };
}
