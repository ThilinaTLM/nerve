import type { ToolName } from "@nervekit/contracts/tools";
import type { ToolExecutionResult } from "../../execution/execution-context.js";
import { type ToolHandlerRegistry, ToolValidationError } from "../types.js";
import { requiredString } from "./args.js";

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
  control: TaskPortHandler;
};

function validateTaskArgs(
  name: TaskToolName,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (name === "task_start") {
    requiredString(args.command, "command");
  } else if (name === "task_logs") {
    requiredString(args.task, "task");
    const mode = typeof args.mode === "string" ? args.mode : "recent";
    if (mode === "first_failure" && args.cursor !== undefined) {
      throw new ToolValidationError(
        "task_logs first_failure does not accept cursor.",
      );
    }
  } else if (name === "task_control") {
    requiredString(args.task, "task");
    if (args.action !== "stop" && args.action !== "restart") {
      throw new ToolValidationError(
        "task_control action must be stop or restart.",
      );
    }
  } else if (name === "task_status") {
    if (args.tasks !== undefined) {
      if (!Array.isArray(args.tasks) || args.tasks.length === 0) {
        throw new ToolValidationError("task_status tasks must not be empty.");
      }
      if (args.tasks.length > 20) {
        throw new ToolValidationError("task_status supports at most 20 tasks.");
      }
      args.tasks.forEach((value, index) =>
        requiredString(value, `tasks[${index}]`),
      );
    }
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
      "recovered",
      "interrupted",
      "recovery_unknown",
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
    task_control: handler("task_control", port.control),
  };
}
