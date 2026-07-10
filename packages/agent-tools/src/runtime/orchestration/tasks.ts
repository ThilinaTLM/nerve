import type { ToolName } from "@nervekit/contracts";
import type { ToolExecutionResult } from "../../types.js";
import { type ToolHandlerRegistry, ToolValidationError } from "../types.js";
import { parseTaskSelector, requiredString } from "./args.js";

export type TaskToolName = Extract<ToolName, `task_${string}`>;

type TaskPortHandler = (
  args: Record<string, unknown>,
  identity: unknown,
  signal?: AbortSignal,
) => Promise<ToolExecutionResult>;

export type TaskToolPort = {
  start: TaskPortHandler;
  status: TaskPortHandler;
  logs: TaskPortHandler;
  cancel: TaskPortHandler;
  restart: TaskPortHandler;
  list: TaskPortHandler;
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
    parseTaskSelector(args, false);
  } else if (name === "task_status") {
    const selectors = [
      typeof args.taskId === "string" && args.taskId.trim().length > 0,
      Array.isArray(args.taskIds),
      typeof args.groupId === "string" && args.groupId.trim().length > 0,
    ].filter(Boolean).length;
    if (selectors > 1) {
      throw new ToolValidationError(
        "task_status accepts at most one of taskId, taskIds, or groupId.",
      );
    }
    if (Array.isArray(args.taskIds) && args.taskIds.length > 20) {
      throw new ToolValidationError("task_status accepts at most 20 task IDs.");
    }
  }
  return args;
}

export function createTaskHandlers(port: TaskToolPort): ToolHandlerRegistry {
  const handler =
    (name: TaskToolName, execute: TaskPortHandler) =>
    async (
      args: Record<string, unknown>,
      context: { identity?: unknown; signal?: AbortSignal },
    ) =>
      execute(validateTaskArgs(name, args), context.identity, context.signal);

  return {
    task_start: handler("task_start", port.start),
    task_status: handler("task_status", port.status),
    task_logs: handler("task_logs", port.logs),
    task_cancel: handler("task_cancel", port.cancel),
    task_restart: handler("task_restart", port.restart),
    task_list: handler("task_list", port.list),
  };
}
