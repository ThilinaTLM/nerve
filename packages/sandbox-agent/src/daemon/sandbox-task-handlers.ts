import { isAbsolute, resolve, sep } from "node:path";
import type { TaskLogQuery } from "@nervekit/contracts";
import {
  taskLogQueryResponseFromSupervised,
  taskRecordFromSupervisedTask,
} from "../tools/task-record-adapter.js";
import type { TaskSupervisor } from "../tools/task-supervisor.js";
import type { SandboxOperationRouter } from "./operation-router.js";
import { SandboxOperationError } from "./errors.js";

export function registerSandboxTaskHandlers(
  router: SandboxOperationRouter,
  supervisor: TaskSupervisor | (() => TaskSupervisor | undefined) | undefined,
  workspaceDir = "/workspace",
): void {
  const requireSupervisor = (): TaskSupervisor => {
    const resolved =
      typeof supervisor === "function" ? supervisor() : supervisor;
    if (!resolved)
      throw new SandboxOperationError(
        "UNAVAILABLE",
        "Task supervisor is unavailable in this sandbox",
      );
    return resolved;
  };

  router.register("task.list", () => ({
    tasks: requireSupervisor().list().map(taskRecordFromSupervisedTask),
  }));
  router.register("task.start", (params) => {
    const input = record(params);
    const task = requireSupervisor().start(
      String(input.command ?? ""),
      resolveWorkspaceCwd(workspaceDir, stringValue(input.cwd) ?? workspaceDir),
      numberValue(input.timeoutMs),
      {
        name: stringValue(input.name),
        env: envValue(input.env),
        origin: { kind: "utility_panel" },
      },
    );
    return { task: taskRecordFromSupervisedTask(task) };
  });
  router.register("task.get", (params) => {
    const task = requireSupervisor().get(taskId(params));
    if (!task) throw unknownTask(taskId(params));
    return { task: taskRecordFromSupervisedTask(task) };
  });
  router.register("task.cancel", (params) => {
    const input = record(params);
    const id = taskId(params);
    const task = requireSupervisor().cancel(
      id,
      signalValue(input.signal) ?? "SIGTERM",
    );
    if (!task) throw unknownTask(id);
    return { task: taskRecordFromSupervisedTask(task) };
  });
  router.register("task.restart", (params) => {
    const id = taskId(params);
    const task = requireSupervisor().restart(id);
    if (!task) throw unknownTask(id);
    return { task: taskRecordFromSupervisedTask(task) };
  });
  router.register("task.prune", async () => ({
    removed: await requireSupervisor().prune(),
  }));
  router.register("task.delete", async (params) => {
    const id = taskId(params);
    try {
      const removed = await requireSupervisor().delete(id);
      if (!removed) throw unknownTask(id);
      return { removed: true };
    } catch (error) {
      if (error instanceof SandboxOperationError) throw error;
      throw new SandboxOperationError(
        "INVALID_RUN_STATE",
        error instanceof Error ? error.message : String(error),
      );
    }
  });
  router.register("task.logs", (params) => {
    const input = record(params);
    const id = taskId(params);
    const query = { ...input } as TaskLogQuery & { taskId?: string };
    delete query.taskId;
    const logs = requireSupervisor().queryLogs(id, query);
    if (!logs) throw unknownTask(id);
    return taskLogQueryResponseFromSupervised(logs);
  });
}

function resolveWorkspaceCwd(workspaceDir: string, cwd: string): string {
  const root = resolve(workspaceDir);
  const target = resolve(root, isAbsolute(cwd) ? cwd : cwd);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new SandboxOperationError(
      "VALIDATION_FAILED",
      "Task cwd must stay within /workspace",
    );
  }
  return target;
}

function taskId(params: unknown): string {
  return String(record(params).taskId ?? "");
}

function unknownTask(id: string): SandboxOperationError {
  return new SandboxOperationError("UNKNOWN_RUN", `Unknown task: ${id}`);
}

function record(params: unknown): Record<string, unknown> {
  return params && typeof params === "object" && !Array.isArray(params)
    ? (params as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function signalValue(value: unknown): NodeJS.Signals | undefined {
  if (value === "SIGTERM" || value === "SIGINT" || value === "SIGKILL")
    return value;
  return undefined;
}

function envValue(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const env: Record<string, string> = {};
  for (const [key, item] of Object.entries(value))
    if (typeof item === "string") env[key] = item;
  return env;
}
