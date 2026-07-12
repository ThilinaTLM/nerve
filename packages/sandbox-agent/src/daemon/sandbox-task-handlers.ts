import { isAbsolute, resolve, sep } from "node:path";
import type { TaskLogQuery } from "@nervekit/contracts";
import type { SandboxTaskService } from "../tools/sandbox-task-service.js";
import { SandboxOperationError } from "./errors.js";
import type { SandboxOperationRouter } from "./operation-router.js";

export function registerSandboxTaskHandlers(
  router: SandboxOperationRouter,
  tasks:
    | SandboxTaskService
    | (() => SandboxTaskService | undefined)
    | undefined,
  workspaceDir = "/workspace",
): void {
  const requireTasks = (): SandboxTaskService => {
    const resolved = typeof tasks === "function" ? tasks() : tasks;
    if (!resolved)
      throw new SandboxOperationError(
        "UNAVAILABLE",
        "Task service is unavailable in this sandbox",
      );
    return resolved;
  };

  router.register("task.list", async () => ({
    tasks: await requireTasks().list(),
  }));
  router.register("task.start", async (params) => {
    const input = record(params);
    const task = await requireTasks().start({
      command: String(input.command ?? ""),
      cwd: resolveWorkspaceCwd(
        workspaceDir,
        stringValue(input.cwd) ?? workspaceDir,
      ),
      timeoutMs: numberValue(input.timeoutMs),
      name: stringValue(input.name),
      env: envValue(input.env),
      origin: { kind: "utility_panel" },
    });
    return { task };
  });
  router.register("task.get", async (params) => {
    const id = taskId(params);
    const task = await requireTasks().get(id);
    if (!task) throw unknownTask(id);
    return { task };
  });
  router.register("task.cancel", async (params) => {
    const input = record(params);
    const id = taskId(params);
    if (!(await requireTasks().get(id))) throw unknownTask(id);
    const task = await requireTasks().cancel(
      id,
      signalValue(input.signal) ?? "SIGTERM",
    );
    return { task };
  });
  router.register("task.restart", async (params) => {
    const id = taskId(params);
    if (!(await requireTasks().get(id))) throw unknownTask(id);
    return { task: await requireTasks().restart(id) };
  });
  router.register("task.prune", async () => ({
    removed: await requireTasks().prune(),
  }));
  router.register("task.delete", async (params) => {
    const id = taskId(params);
    try {
      if (!(await requireTasks().delete(id))) throw unknownTask(id);
      return { removed: true };
    } catch (error) {
      if (error instanceof SandboxOperationError) throw error;
      throw new SandboxOperationError(
        "INVALID_RUN_STATE",
        error instanceof Error ? error.message : String(error),
      );
    }
  });
  router.register("task.logs", async (params) => {
    const input = record(params);
    const id = taskId(params);
    if (!(await requireTasks().get(id))) throw unknownTask(id);
    const query = { ...input } as TaskLogQuery & { taskId?: string };
    delete query.taskId;
    return requireTasks().logs(id, query);
  });
}

function resolveWorkspaceCwd(workspaceDir: string, cwd: string): string {
  const root = resolve(workspaceDir);
  const target = resolve(root, isAbsolute(cwd) ? cwd : cwd);
  if (target !== root && !target.startsWith(`${root}${sep}`))
    throw new SandboxOperationError(
      "VALIDATION_FAILED",
      "Task cwd must stay within /workspace",
    );
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
function signalValue(
  value: unknown,
): "SIGTERM" | "SIGINT" | "SIGKILL" | undefined {
  return value === "SIGTERM" || value === "SIGINT" || value === "SIGKILL"
    ? value
    : undefined;
}
function envValue(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}
