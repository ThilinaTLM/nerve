import type { WorkbenchTaskService } from "../tasks/workbench-task-service.js";

export function stringArg(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Tool argument '${name}' must be a non-empty string.`);
  }
  return value;
}

export function optionalStringArg(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

export function stringRecordArg(
  value: unknown,
): Record<string, string> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const output: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "string") output[key] = raw;
  }
  return output;
}

export function signalArg(
  value: unknown,
): "SIGTERM" | "SIGINT" | "SIGKILL" | undefined {
  return value === "SIGINT" || value === "SIGKILL" || value === "SIGTERM"
    ? value
    : undefined;
}

export function optionalFiniteNumberArg(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function optionalBoundedIntegerArg(
  value: unknown,
  name: string,
  options: { min: number; max: number },
): number | undefined {
  const parsed = optionalFiniteNumberArg(value);
  if (parsed === undefined) return undefined;
  if (
    !Number.isInteger(parsed) ||
    parsed < options.min ||
    parsed > options.max
  ) {
    throw new Error(
      `Tool argument '${name}' must be an integer between ${options.min} and ${options.max}.`,
    );
  }
  return parsed;
}

export function taskIdArg(
  args: Record<string, unknown>,
  tasks: WorkbenchTaskService,
  projectId: string,
): string {
  const taskId = typeof args.taskId === "string" ? args.taskId.trim() : "";
  if (!taskId) {
    throw new Error("Tool argument 'taskId' is required.");
  }
  const task = tasks.getTask(taskId);
  if (task.projectId !== projectId) {
    throw new Error("Task is outside this agent's project scope.");
  }
  return task.id;
}
