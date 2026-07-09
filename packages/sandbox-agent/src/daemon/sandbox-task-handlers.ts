import { isAbsolute, resolve, sep } from "node:path";
import type { TaskLogQuery } from "@nervekit/shared";
import {
  taskLogQueryResponseFromSupervised,
  taskRecordFromSupervisedTask,
} from "../tools/task-record-adapter.js";
import type { TaskSupervisor } from "../tools/task-supervisor.js";
import type { SandboxCommandRouter } from "./command-router.js";
import { SandboxCommandError } from "./errors.js";

export function registerSandboxTaskHandlers(
  router: SandboxCommandRouter,
  supervisor: TaskSupervisor | (() => TaskSupervisor | undefined) | undefined,
  workspaceDir = "/workspace",
): void {
  const requireSupervisor = (): TaskSupervisor => {
    const resolved =
      typeof supervisor === "function" ? supervisor() : supervisor;
    if (!resolved)
      throw new SandboxCommandError(
        "UNAVAILABLE",
        "Task supervisor is unavailable in this sandbox",
      );
    return resolved;
  };

  router.register("sandbox.task.list", () => ({
    tasks: requireSupervisor().list().map(taskRecordFromSupervisedTask),
  }));
  router.register("sandbox.task.start", (params) => {
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
  router.register("sandbox.task.get", (params) => {
    const task = requireSupervisor().get(taskId(params));
    if (!task) throw unknownTask(taskId(params));
    return { task: taskRecordFromSupervisedTask(task) };
  });
  router.register("sandbox.task.cancel", (params) => {
    const input = record(params);
    const id = taskId(params);
    const task = requireSupervisor().cancel(
      id,
      signalValue(input.signal) ?? "SIGTERM",
    );
    if (!task) throw unknownTask(id);
    return { task: taskRecordFromSupervisedTask(task) };
  });
  router.register("sandbox.task.restart", (params) => {
    const id = taskId(params);
    const task = requireSupervisor().restart(id);
    if (!task) throw unknownTask(id);
    return { task: taskRecordFromSupervisedTask(task) };
  });
  router.register("sandbox.task.prune", async () => ({
    removed: await requireSupervisor().prune(),
  }));
  router.register("sandbox.task.delete", async (params) => {
    const id = taskId(params);
    try {
      const removed = await requireSupervisor().delete(id);
      if (!removed) throw unknownTask(id);
      return { removed: true };
    } catch (error) {
      if (error instanceof SandboxCommandError) throw error;
      throw new SandboxCommandError(
        "INVALID_RUN_STATE",
        error instanceof Error ? error.message : String(error),
      );
    }
  });
  router.register("sandbox.task.logs", (params) => {
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
    throw new SandboxCommandError(
      "VALIDATION_FAILED",
      "Task cwd must stay within /workspace",
    );
  }
  return target;
}

function taskId(params: unknown): string {
  return String(record(params).taskId ?? "");
}

function unknownTask(id: string): SandboxCommandError {
  return new SandboxCommandError("UNKNOWN_RUN", `Unknown task: ${id}`);
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
