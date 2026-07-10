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
import {
  taskLogQueryResponseFromSupervised,
  taskRecordFromSupervisedTask,
} from "./task-record-adapter.js";
import type { SupervisedTask, TaskSupervisor } from "./task-supervisor.js";
import type { ToolRuntimeScope } from "./tool-scope.js";

export function createSandboxTaskHandlers(
  options: SandboxOrchestrationHandlerOptions,
): ToolHandlerRegistry {
  const supervisor = () => {
    if (!options.taskSupervisor) {
      throw new Error("UNAVAILABLE: task supervisor is not configured");
    }
    return options.taskSupervisor;
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
      const tasks = inputs.map((input) =>
        supervisor().start(
          requiredString(input.command, "command"),
          resolveTaskCwd(options.workspaceDir, optionalString(input.cwd)),
          optionalNumber(input.timeoutMs),
          {
            name: optionalString(input.name),
            groupId,
            groupName,
            env: stringRecord(input.env),
            ...current.scope,
            toolCallId: current.toolCallId,
          },
        ),
      );
      const records = tasks.map(taskRecordFromSupervisedTask);
      return taskResult(
        `Started ${records.length} task${records.length === 1 ? "" : "s"} in group ${groupId}.`,
        { tasks: records, task: records[0], groupId, groupName },
      );
    },
    status: async (args, value) => {
      const tasks = selectStatusTasks(
        supervisor(),
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
        supervisor(),
        current.scope,
        optionalString(args.taskId),
        optionalString(args.groupId),
      );
      if (!task) return taskResult("No matching tasks found.", { events: [] });
      const response = supervisor().queryLogs(task.id, taskLogQuery(args));
      if (!response) throw new Error(`Unknown task: ${task.id}`);
      const result = taskLogQueryResponseFromSupervised(response);
      const content = result.events.map((event) => event.line).join("\n");
      return taskResult(content || "No matching task logs.", result);
    },
    cancel: async (args, value) => {
      const current = sandboxOrchestrationIdentity(value);
      const taskId = optionalString(args.taskId);
      const groupId = optionalString(args.groupId);
      const targets = selectTaskTargets(
        supervisor(),
        current.scope,
        taskId,
        groupId,
        true,
      );
      if (!taskId && !groupId && targets.length > 1) {
        return taskResult(
          `Multiple active tasks found (${targets.length}); no tasks cancelled. Provide taskId/name or groupId.`,
          { tasks: targets.map(taskRecordFromSupervisedTask) },
        );
      }
      const signal = taskSignal(args.signal);
      const cancelled = targets
        .map((task) => supervisor().cancel(task.id, signal))
        .filter((task): task is SupervisedTask => Boolean(task))
        .map(taskRecordFromSupervisedTask);
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
        supervisor(),
        current.scope,
        requiredString(args.taskId, "taskId"),
      );
      if (!original) throw new Error(`Unknown task: ${String(args.taskId)}`);
      const restarted = supervisor().restart(original.id);
      if (!restarted) throw new Error(`Unknown task: ${original.id}`);
      const task = taskRecordFromSupervisedTask(restarted);
      return taskResult(`Restarted ${original.id} as ${task.id}`, {
        task,
        tasks: [task],
        restartedFromTaskId: original.id,
        newTaskId: task.id,
      });
    },
    list: async (args, value) => {
      const current = sandboxOrchestrationIdentity(value);
      let tasks = tasksInScope(supervisor(), current.scope);
      const status = optionalString(args.status);
      const groupId = optionalString(args.groupId);
      if (status) tasks = tasks.filter((task) => task.status === status);
      if (groupId) tasks = tasks.filter((task) => task.groupId === groupId);
      if (args.activeOnly === true) tasks = tasks.filter(isActiveTask);
      const limit = optionalNumber(args.limit) ?? 20;
      const records = tasks.slice(0, limit).map(taskRecordFromSupervisedTask);
      return taskResult(boundedSummary(JSON.stringify(records, null, 2)), {
        tasks: records,
        groupId,
      });
    },
  });
}

function tasksInScope(
  supervisor: TaskSupervisor,
  scope: ToolRuntimeScope,
): SupervisedTask[] {
  return supervisor
    .list()
    .filter(
      (task) =>
        (!task.conversationId ||
          task.conversationId === scope.conversationId) &&
        (!task.agentId || task.agentId === scope.agentId),
    );
}

function selectStatusTasks(
  supervisor: TaskSupervisor,
  scope: ToolRuntimeScope,
  args: Record<string, unknown>,
): TaskRecord[] {
  const taskId = optionalString(args.taskId);
  const taskIds = Array.isArray(args.taskIds)
    ? args.taskIds.map((value) => requiredString(value, "taskId"))
    : undefined;
  const groupId = optionalString(args.groupId);
  let tasks: SupervisedTask[];
  if (taskId) {
    const selected = selectSingleTask(supervisor, scope, taskId);
    tasks = selected ? [selected] : [];
  } else if (taskIds) {
    tasks = taskIds.map((id) => {
      const selected = selectSingleTask(supervisor, scope, id);
      if (!selected) throw new Error(`Unknown task: ${id}`);
      return selected;
    });
  } else if (groupId) {
    tasks = tasksInScope(supervisor, scope).filter(
      (task) => task.groupId === groupId,
    );
  } else {
    const scoped = tasksInScope(supervisor, scope);
    const active = scoped.filter(isActiveTask);
    tasks = active.length > 0 ? active : scoped;
  }
  if (args.activeOnly === true) tasks = tasks.filter(isActiveTask);
  const limit = optionalNumber(args.limit) ?? 5;
  return tasks.slice(0, limit).map(taskRecordFromSupervisedTask);
}

function selectTaskTargets(
  supervisor: TaskSupervisor,
  scope: ToolRuntimeScope,
  taskId?: string,
  groupId?: string,
  activeOnly = false,
): SupervisedTask[] {
  if (taskId) {
    const selected = selectSingleTask(
      supervisor,
      scope,
      taskId,
      undefined,
      activeOnly,
    );
    return selected ? [selected] : [];
  }
  let tasks = tasksInScope(supervisor, scope);
  if (groupId) tasks = tasks.filter((task) => task.groupId === groupId);
  return activeOnly ? tasks.filter(isActiveTask) : tasks;
}

function selectSingleTask(
  supervisor: TaskSupervisor,
  scope: ToolRuntimeScope,
  taskId?: string,
  groupId?: string,
  activeOnly = false,
): SupervisedTask | undefined {
  let candidates = tasksInScope(supervisor, scope);
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

function isActiveTask(task: SupervisedTask): boolean {
  return task.status === "running";
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
  return (
    value === "recent" ||
    value === "errors" ||
    value === "warnings" ||
    value === "since_cursor" ||
    value === "first_failure"
  );
}

function taskSignal(value: unknown): NodeJS.Signals {
  return value === "SIGINT" || value === "SIGKILL" ? value : "SIGTERM";
}

function assertSupportedTaskStart(inputs: Record<string, unknown>[]): void {
  for (const input of inputs) {
    if (input.readyUrl || input.readyOnUrl || input.readyPattern) {
      throw new ToolValidationError(
        "Sandbox supervised tasks do not support readiness probes yet.",
      );
    }
  }
}

function resolveTaskCwd(workspaceDir: string, value?: string): string {
  const resolved = path.resolve(workspaceDir, value ?? ".");
  const relative = path.relative(path.resolve(workspaceDir), resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ToolValidationError(
      "Task cwd must be inside the sandbox workspace.",
    );
  }
  return resolved;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ToolValidationError(`${name} must be a non-empty string.`);
  }
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
  const entries = Object.entries(value);
  if (!entries.every(([, item]) => typeof item === "string")) {
    throw new ToolValidationError("Task env values must be strings.");
  }
  return Object.fromEntries(entries) as Record<string, string>;
}
