import path from "node:path";
import {
  boundedSummary,
  createTaskHandlers,
  type ToolHandlerRegistry,
  ToolValidationError,
} from "@nervekit/host-runtime/tools";
import {
  createId,
  type TaskLogQuery,
  type TaskRecord,
} from "@nervekit/contracts";
import {
  type SandboxOrchestrationHandlerOptions,
  sandboxOrchestrationIdentity,
  taskResult,
} from "./sandbox-orchestration-types.js";
import type { ToolRuntimeScope } from "./tool-scope.js";

export function createSandboxTaskHandlers(
  options: SandboxOrchestrationHandlerOptions,
): ToolHandlerRegistry {
  const service = () => {
    if (!options.taskService)
      throw new Error("UNAVAILABLE: task service is not configured");
    return options.taskService;
  };

  return createTaskHandlers({
    start: async (args, value) => {
      const current = sandboxOrchestrationIdentity(value);
      const inputs = Array.isArray(args.tasks)
        ? (args.tasks as Record<string, unknown>[])
        : [args];
      assertSupportedTaskStart(inputs);
      const groupId = createId("taskgrp");
      const groupName = optionalString(args.name);
      const tasks = await Promise.all(
        inputs.map((input) =>
          service().start({
            command: requiredString(input.command, "command"),
            cwd: resolveTaskCwd(
              options.workspaceDir,
              optionalString(input.cwd),
            ),
            timeoutMs: optionalNumber(input.timeoutMs),
            name: optionalString(input.name),
            groupId,
            groupName,
            env: stringRecord(input.env),
            conversationId: current.scope.conversationId,
            agentId: current.scope.agentId,
            origin: {
              kind: "agent_tool",
              toolCallId: current.toolCallId,
              runId: current.scope.runId,
            },
          }),
        ),
      );
      return taskResult(
        `Started ${tasks.length} task${tasks.length === 1 ? "" : "s"} in group ${groupId}.`,
        { tasks, task: tasks[0], groupId, groupName },
      );
    },
    status: async (args, value) => {
      const tasks = await selectStatusTasks(
        await service().list(),
        sandboxOrchestrationIdentity(value).scope,
        args,
      );
      return taskResult(boundedSummary(JSON.stringify(tasks, null, 2)), {
        tasks,
      });
    },
    logs: async (args, value) => {
      const current = sandboxOrchestrationIdentity(value);
      const task = selectSingleTask(
        await service().list(),
        current.scope,
        optionalString(args.taskId),
        optionalString(args.groupId),
      );
      if (!task) return taskResult("No matching tasks found.", { events: [] });
      const result = await service().logs(task.id, taskLogQuery(args));
      const content = result.events.map((event) => event.line).join("\n");
      return taskResult(content || "No matching task logs.", result);
    },
    cancel: async (args, value) => {
      const current = sandboxOrchestrationIdentity(value);
      const taskId = optionalString(args.taskId);
      const groupId = optionalString(args.groupId);
      const targets = selectTaskTargets(
        await service().list(),
        current.scope,
        taskId,
        groupId,
        true,
      );
      if (!taskId && !groupId && targets.length > 1) {
        return taskResult(
          `Multiple active tasks found (${targets.length}); no tasks cancelled. Provide taskId/name or groupId.`,
          { tasks: targets },
        );
      }
      const cancelled = await Promise.all(
        targets.map((task) =>
          service().cancel(task.id, taskSignal(args.signal)),
        ),
      );
      return taskResult(
        cancelled.length
          ? `Cancelled ${cancelled.map((task) => task.id).join(", ")}`
          : "No active matching tasks to cancel.",
        { tasks: cancelled, task: cancelled[0] },
      );
    },
    restart: async (args, value) => {
      const current = sandboxOrchestrationIdentity(value);
      const original = selectSingleTask(
        await service().list(),
        current.scope,
        requiredString(args.taskId, "taskId"),
      );
      if (!original) throw new Error(`Unknown task: ${String(args.taskId)}`);
      const task = await service().restart(original.id);
      return taskResult(`Restarted ${original.id} as ${task.id}`, {
        task,
        tasks: [task],
        restartedFromTaskId: original.id,
        newTaskId: task.id,
      });
    },
    list: async (args, value) => {
      const current = sandboxOrchestrationIdentity(value);
      let tasks = tasksInScope(await service().list(), current.scope);
      const status = optionalString(args.status);
      const groupId = optionalString(args.groupId);
      if (status) tasks = tasks.filter((task) => task.status === status);
      if (groupId) tasks = tasks.filter((task) => task.groupId === groupId);
      if (args.activeOnly === true) tasks = tasks.filter(isActiveTask);
      const limit = optionalNumber(args.limit) ?? 20;
      tasks = tasks.slice(0, limit);
      return taskResult(boundedSummary(JSON.stringify(tasks, null, 2)), {
        tasks,
        groupId,
      });
    },
  });
}

function tasksInScope(
  tasks: TaskRecord[],
  scope: ToolRuntimeScope,
): TaskRecord[] {
  return tasks.filter(
    (task) =>
      (!task.conversationId || task.conversationId === scope.conversationId) &&
      (!task.agentId || task.agentId === scope.agentId),
  );
}

function selectStatusTasks(
  all: TaskRecord[],
  scope: ToolRuntimeScope,
  args: Record<string, unknown>,
): TaskRecord[] {
  const taskId = optionalString(args.taskId);
  const taskIds = Array.isArray(args.taskIds)
    ? args.taskIds.map((value) => requiredString(value, "taskId"))
    : undefined;
  const groupId = optionalString(args.groupId);
  let tasks: TaskRecord[];
  if (taskId) {
    const selected = selectSingleTask(all, scope, taskId);
    tasks = selected ? [selected] : [];
  } else if (taskIds) {
    tasks = taskIds.map((id) => {
      const selected = selectSingleTask(all, scope, id);
      if (!selected) throw new Error(`Unknown task: ${id}`);
      return selected;
    });
  } else if (groupId) {
    tasks = tasksInScope(all, scope).filter((task) => task.groupId === groupId);
  } else {
    const scoped = tasksInScope(all, scope);
    const active = scoped.filter(isActiveTask);
    tasks = active.length ? active : scoped;
  }
  if (args.activeOnly === true) tasks = tasks.filter(isActiveTask);
  return tasks.slice(0, optionalNumber(args.limit) ?? 5);
}

function selectTaskTargets(
  all: TaskRecord[],
  scope: ToolRuntimeScope,
  taskId?: string,
  groupId?: string,
  activeOnly = false,
): TaskRecord[] {
  if (taskId) {
    const selected = selectSingleTask(
      all,
      scope,
      taskId,
      undefined,
      activeOnly,
    );
    return selected ? [selected] : [];
  }
  let tasks = tasksInScope(all, scope);
  if (groupId) tasks = tasks.filter((task) => task.groupId === groupId);
  return activeOnly ? tasks.filter(isActiveTask) : tasks;
}

function selectSingleTask(
  all: TaskRecord[],
  scope: ToolRuntimeScope,
  taskId?: string,
  groupId?: string,
  activeOnly = false,
): TaskRecord | undefined {
  let candidates = tasksInScope(all, scope);
  if (groupId)
    candidates = candidates.filter((task) => task.groupId === groupId);
  if (activeOnly) candidates = candidates.filter(isActiveTask);
  if (!taskId) return candidates.find(isActiveTask) ?? candidates[0];
  const exact = candidates.find((task) => task.id === taskId);
  if (exact) return exact;
  const named = candidates.filter((task) => task.name === taskId);
  if (named.length === 1) return named[0];
  const activeNamed = named.filter(isActiveTask);
  if (activeNamed.length === 1) return activeNamed[0];
  if (named.length > 1) {
    const lineages = new Set(
      named.map((task) => task.restartRootTaskId ?? task.id),
    );
    if (lineages.size === 1) return named[0];
    throw new ToolValidationError(
      `Task name '${taskId}' is ambiguous. Use a task ID or groupId.`,
    );
  }
  return undefined;
}

function isActiveTask(task: TaskRecord): boolean {
  return ["starting", "running", "ready", "stopping"].includes(task.status);
}

function taskLogQuery(args: Record<string, unknown>): TaskLogQuery {
  return {
    mode: isLogMode(args.mode) ? args.mode : undefined,
    sinceSeq: optionalNumber(args.sinceSeq),
    contains: optionalString(args.contains),
    regex: optionalString(args.regex),
    contextLines: optionalNumber(args.contextLines),
    limit: optionalNumber(args.limit) ?? 80,
  };
}

function isLogMode(value: unknown): value is NonNullable<TaskLogQuery["mode"]> {
  return [
    "recent",
    "errors",
    "warnings",
    "since_cursor",
    "first_failure",
  ].includes(String(value));
}

function taskSignal(value: unknown): "SIGTERM" | "SIGINT" | "SIGKILL" {
  return value === "SIGINT" || value === "SIGKILL" ? value : "SIGTERM";
}

function assertSupportedTaskStart(inputs: Record<string, unknown>[]): void {
  for (const input of inputs) {
    if (input.readyUrl || input.readyOnUrl || input.readyPattern)
      throw new ToolValidationError(
        "Sandbox tasks do not support readiness probes yet.",
      );
  }
}

function resolveTaskCwd(workspaceDir: string, value?: string): string {
  const resolved = path.resolve(workspaceDir, value ?? ".");
  const relative = path.relative(path.resolve(workspaceDir), resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new ToolValidationError(
      "Task cwd must be inside the sandbox workspace.",
    );
  return resolved;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new ToolValidationError(`${name} must be a non-empty string.`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}
