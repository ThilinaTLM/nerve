import path from "node:path";
import {
  boundedSummary,
  createTaskHandlers,
  type ToolHandlerRegistry,
  ToolValidationError,
} from "@nervekit/host-runtime/tools";
import {
  type TaskCancelResultPayload,
  taskCancelToolResultSchema,
  type TaskLogQuery,
  taskLogsToolResultSchema,
  type TaskRecord,
  type TaskStatus,
  taskRestartToolResultSchema,
  taskStartToolResultSchema,
  taskStatusToolResultSchema,
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
      assertSupportedTaskStart(args);
      const task = await service().start({
        command: requiredString(args.command, "command"),
        cwd: resolveTaskCwd(options.workspaceDir, optionalString(args.cwd)),
        timeoutMs: optionalNumber(args.timeoutMs),
        name: optionalString(args.name),
        env: stringRecord(args.env),
        notify: typeof args.notify === "boolean" ? args.notify : true,
        conversationId: current.scope.conversationId,
        agentId: current.scope.agentId,
        origin: {
          kind: "agent_tool",
          toolCallId: current.toolCallId,
          runId: current.scope.runId,
        },
      });
      const details = taskStartToolResultSchema.parse({ task });
      return taskResult(`Started background task ${task.id}.`, details);
    },
    status: async (args, value) => {
      const tasks = selectStatusTasks(
        await service().list(),
        sandboxOrchestrationIdentity(value).scope,
        args,
      );
      const details = taskStatusToolResultSchema.parse({ tasks });
      return taskResult(
        boundedSummary(JSON.stringify(tasks, null, 2)),
        details,
      );
    },
    logs: async (args, value) => {
      const current = sandboxOrchestrationIdentity(value);
      const ref = requiredString(args.taskId, "taskId");
      const task = resolveTask(await service().list(), current.scope, ref);
      if (!task) throw new ToolValidationError(`Unknown task: ${ref}`);
      const response = await service().logs(task.id, taskLogQuery(args));
      const details = taskLogsToolResultSchema.parse(response);
      const content = response.events.map((event) => event.line).join("\n");
      return taskResult(content || "No matching task logs.", details);
    },
    cancel: async (args, value) => {
      const current = sandboxOrchestrationIdentity(value);
      const all = await service().list();
      const targets = resolveCancelTargets(all, current.scope, args);
      const signal = taskSignal(args.signal);
      if (targets.length === 0) {
        const cancelResults: TaskCancelResultPayload[] = [
          {
            requestedSignal: signal,
            outcome: "no_matching_active_task",
            message: "No matching tasks to cancel.",
          },
        ];
        const details = taskCancelToolResultSchema.parse({
          tasks: [],
          cancelResults,
        });
        return taskResult("No matching tasks to cancel.", details);
      }
      const outcomes = await Promise.all(
        targets.map(async (before) => {
          const after = await service().cancel(before.id, signal);
          return {
            task: after,
            result: cancelResult(before, after, signal),
          };
        }),
      );
      const tasks = outcomes.map((outcome) => outcome.task);
      const cancelResults = outcomes.map((outcome) => outcome.result);
      const details = taskCancelToolResultSchema.parse({
        tasks,
        cancelResults,
      });
      return taskResult(
        cancelResults.map((result) => result.message).join("\n"),
        details,
      );
    },
    restart: async (args, value) => {
      const current = sandboxOrchestrationIdentity(value);
      const ref = requiredString(args.taskId, "taskId");
      const original = resolveTask(await service().list(), current.scope, ref);
      if (!original) throw new ToolValidationError(`Unknown task: ${ref}`);
      const task = await service().restart(original.id);
      const details = taskRestartToolResultSchema.parse({
        task,
        restartedFromTaskId: original.id,
        newTaskId: task.id,
        restartRootTaskId: task.restartRootTaskId ?? original.id,
      });
      return taskResult(`Restarted ${original.id} as ${task.id}.`, details);
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
    ? args.taskIds.map((value, index) =>
        requiredString(value, `taskIds[${index}]`),
      )
    : undefined;
  const groupId = optionalString(args.groupId);
  const selectorCount = [taskId, taskIds, groupId].filter(Boolean).length;
  if (selectorCount > 1 || (taskIds && taskIds.length === 0)) {
    throw new ToolValidationError(
      "Provide at most one non-empty selector: taskId, taskIds, or groupId.",
    );
  }
  let tasks = taskId
    ? [requiredResolvedTask(all, scope, taskId)]
    : taskIds
      ? taskIds.map((ref) => requiredResolvedTask(all, scope, ref))
      : groupId
        ? tasksInScope(all, scope).filter((task) => task.groupId === groupId)
        : tasksInScope(all, scope);
  const status = optionalString(args.status) as
    | TaskStatus
    | "active"
    | "all"
    | undefined;
  if (status === "active" || (!status && selectorCount === 0)) {
    tasks = tasks.filter(isActiveTask);
  } else if (status && status !== "all") {
    tasks = tasks.filter((task) => task.status === status);
  }
  return tasks.slice(0, optionalNumber(args.limit) ?? 20);
}

function resolveCancelTargets(
  all: TaskRecord[],
  scope: ToolRuntimeScope,
  args: Record<string, unknown>,
): TaskRecord[] {
  const taskId = optionalString(args.taskId);
  const taskIds = Array.isArray(args.taskIds)
    ? args.taskIds.map((value, index) =>
        requiredString(value, `taskIds[${index}]`),
      )
    : undefined;
  const groupId = optionalString(args.groupId);
  const selectorCount = [taskId, taskIds, groupId].filter(Boolean).length;
  if (selectorCount !== 1 || (taskIds && taskIds.length === 0)) {
    throw new ToolValidationError(
      "Provide exactly one non-empty selector: taskId, taskIds, or groupId.",
    );
  }
  const resolved = taskId
    ? [requiredResolvedTask(all, scope, taskId)]
    : taskIds
      ? taskIds.map((ref) => requiredResolvedTask(all, scope, ref))
      : tasksInScope(all, scope).filter((task) => task.groupId === groupId);
  return [...new Map(resolved.map((task) => [task.id, task])).values()];
}

function requiredResolvedTask(
  all: TaskRecord[],
  scope: ToolRuntimeScope,
  ref: string,
): TaskRecord {
  const task = resolveTask(all, scope, ref);
  if (!task) throw new ToolValidationError(`Unknown task: ${ref}`);
  return task;
}

function resolveTask(
  all: TaskRecord[],
  scope: ToolRuntimeScope,
  ref: string,
): TaskRecord | undefined {
  const candidates = tasksInScope(all, scope);
  const exact = candidates.find((task) => task.id === ref);
  if (exact) return exact;
  const named = candidates.filter((task) => task.name === ref);
  if (named.length === 1) return named[0];
  const activeNamed = named.filter(isActiveTask);
  if (activeNamed.length === 1) return activeNamed[0];
  if (named.length > 1) {
    const lineages = new Set(
      named.map((task) => task.restartRootTaskId ?? task.id),
    );
    if (lineages.size === 1) {
      return [...named].sort((a, b) =>
        b.startedAt.localeCompare(a.startedAt),
      )[0];
    }
    throw new ToolValidationError(
      `Task name '${ref}' is ambiguous. Use a task ID.`,
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

function cancelResult(
  before: TaskRecord,
  after: TaskRecord,
  requestedSignal: "SIGTERM" | "SIGINT" | "SIGKILL",
): TaskCancelResultPayload {
  const label = after.name ? `${after.name} (${after.id})` : after.id;
  if (!isActiveTask(before) && before.status !== "orphaned") {
    return {
      taskId: after.id,
      taskName: after.name,
      requestedSignal,
      outcome: "already_terminal",
      status: after.status,
      message: `${label} was already ${before.status}; no signal was sent.`,
    };
  }
  if (!isActiveTask(after)) {
    return {
      taskId: after.id,
      taskName: after.name,
      requestedSignal,
      outcome:
        after.status === "cancelled"
          ? "cancelled"
          : "became_terminal_before_cancel",
      status: after.status,
      message:
        after.status === "cancelled"
          ? `${label} cancelled with ${after.signal ?? requestedSignal}.`
          : `${label} became ${after.status} before cancellation completed.`,
    };
  }
  return {
    taskId: after.id,
    taskName: after.name,
    requestedSignal,
    outcome: "no_matching_active_task",
    status: after.status,
    message: `${label} is still ${after.status}.`,
  };
}

function assertSupportedTaskStart(args: Record<string, unknown>): void {
  if (args.tasks !== undefined) {
    throw new ToolValidationError("task_start does not accept tasks[].");
  }
  if (args.readyUrl || args.readyOnUrl || args.readyPattern) {
    throw new ToolValidationError(
      "Sandbox tasks do not support readiness probes yet.",
    );
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
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}
