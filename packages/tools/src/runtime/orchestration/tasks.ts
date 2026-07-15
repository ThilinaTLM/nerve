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
};

function validateTaskArgs(
  name: TaskToolName,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (name === "task_start") {
    requiredString(args.command, "command");
    if (args.tasks !== undefined) {
      throw new ToolValidationError("task_start does not accept tasks[].");
    }
  } else if (name === "task_restart" || name === "task_logs") {
    requiredString(args.taskId, "taskId");
    if (args.groupId !== undefined || args.taskIds !== undefined) {
      throw new ToolValidationError(`${name} accepts only taskId.`);
    }
  } else if (name === "task_cancel") {
    parseTaskSelector(args, {
      required: true,
      allowTaskIds: true,
      maxTaskIds: 20,
    });
  } else if (name === "task_status") {
    parseTaskSelector(args, {
      required: false,
      allowTaskIds: true,
      maxTaskIds: 20,
    });
    const statuses = new Set([
      "active",
      "all",
      "starting",
      "running",
      "ready",
      "stopping",
      "completed",
      "failed",
      "timed_out",
      "cancelled",
      "orphaned",
    ]);
    if (args.status !== undefined && !statuses.has(args.status as string)) {
      throw new ToolValidationError("task_status received an invalid status.");
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
  };
}
