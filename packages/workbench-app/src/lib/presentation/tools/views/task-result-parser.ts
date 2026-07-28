import {
  taskCancelResultSchema,
  taskCancelToolResultPreviewSchema,
  taskLogEventSchema,
  taskLogsToolResultPreviewSchema,
  taskRecordSchema,
  taskRestartToolResultPreviewSchema,
  taskStartToolResultPreviewSchema,
  taskStatusToolResultPreviewSchema,
  taskToolSummarySchema,
  type TaskCancelOutcomePreviewPayload,
  type TaskLogEvent,
  type TaskRecord,
  type TaskToolSummaryPayload,
} from "@nervekit/contracts";

export type ParsedTaskActionResult = {
  task?: TaskToolSummaryPayload;
  tasks?: TaskToolSummaryPayload[];
  outcomes?: TaskCancelOutcomePreviewPayload[];
  restartedFromTaskId?: string;
  previewUnavailable: boolean;
};

export type ParsedTaskStatusResult = {
  tasks: TaskToolSummaryPayload[];
  previewUnavailable: boolean;
};

export type ParsedTaskLogsResult = {
  task?: TaskToolSummaryPayload;
  events: TaskLogEvent[];
  nextCursor?: number;
  mode?: string;
  previewUnavailable: boolean;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function taskSummaryFromRecord(task: TaskRecord): TaskToolSummaryPayload {
  const hasTermination =
    task.exitCode !== undefined ||
    task.signal !== undefined ||
    task.error !== undefined;
  const hasLineage = Boolean(task.groupId || task.restartedFromTaskId);
  return {
    id: task.id,
    name: task.name,
    cwd: task.cwd,
    command: task.command,
    status: task.status,
    readiness: {
      outcome: task.readiness.outcome,
      readyUrl: task.readiness.readyUrl,
      readyOnUrl: task.readiness.readyOnUrl,
      matched: task.readiness.matched,
    },
    timing: {
      startedAt: task.startedAt,
      finishedAt: task.finishedAt,
    },
    termination: hasTermination
      ? {
          exitCode: task.exitCode,
          signal: task.signal,
          error: task.error,
        }
      : undefined,
    lineage: hasLineage
      ? {
          groupId: task.groupId,
          restartedFromTaskId: task.restartedFromTaskId,
        }
      : undefined,
  };
}

function taskSummary(value: unknown): TaskToolSummaryPayload | undefined {
  const compact = taskToolSummarySchema.safeParse(value);
  if (compact.success) return compact.data;
  const full = taskRecordSchema.safeParse(value);
  return full.success ? taskSummaryFromRecord(full.data) : undefined;
}

function taskSummaries(value: unknown): {
  tasks: TaskToolSummaryPayload[];
  valid: boolean;
} {
  if (!Array.isArray(value)) return { tasks: [], valid: false };
  const tasks: TaskToolSummaryPayload[] = [];
  let valid = true;
  for (const item of value) {
    const task = taskSummary(item);
    if (task) tasks.push(task);
    else valid = false;
  }
  return { tasks, valid };
}

function logEvents(value: unknown): {
  events: TaskLogEvent[];
  valid: boolean;
} {
  if (!Array.isArray(value)) return { events: [], valid: false };
  const events: TaskLogEvent[] = [];
  let valid = true;
  for (const item of value) {
    const parsed = taskLogEventSchema.safeParse(item);
    if (parsed.success) events.push(parsed.data);
    else valid = false;
  }
  return { events, valid };
}

export function parseTaskStartResult(
  rawResult: unknown,
): ParsedTaskActionResult {
  const compact = taskStartToolResultPreviewSchema.safeParse(rawResult);
  if (compact.success) {
    return { task: compact.data.task, previewUnavailable: false };
  }
  const task = taskSummary(record(rawResult).task);
  return { task, previewUnavailable: !task };
}

export function parseTaskRestartResult(
  rawResult: unknown,
): ParsedTaskActionResult {
  const compact = taskRestartToolResultPreviewSchema.safeParse(rawResult);
  if (compact.success) {
    return {
      task: compact.data.task,
      restartedFromTaskId: compact.data.restartedFromTaskId,
      previewUnavailable: false,
    };
  }
  const result = record(rawResult);
  const task = taskSummary(result.task);
  const restartedFromTaskId =
    typeof result.restartedFromTaskId === "string"
      ? result.restartedFromTaskId
      : task?.lineage?.restartedFromTaskId;
  return {
    task,
    restartedFromTaskId,
    previewUnavailable: !task || !restartedFromTaskId,
  };
}

export function parseTaskCancelResult(
  rawResult: unknown,
): ParsedTaskActionResult {
  const compact = taskCancelToolResultPreviewSchema.safeParse(rawResult);
  if (compact.success) {
    return {
      tasks: compact.data.outcomes.flatMap((outcome) =>
        outcome.task ? [outcome.task] : [],
      ),
      outcomes: compact.data.outcomes,
      previewUnavailable: false,
    };
  }

  const result = record(rawResult);
  const taskValues = Array.isArray(result.tasks) ? result.tasks : [];
  if (!Array.isArray(result.cancelResults)) {
    return { tasks: [], outcomes: [], previewUnavailable: true };
  }
  const outcomes: TaskCancelOutcomePreviewPayload[] = [];
  let valid = true;
  for (let index = 0; index < result.cancelResults.length; index += 1) {
    const parsed = taskCancelResultSchema.safeParse(
      result.cancelResults[index],
    );
    if (!parsed.success) {
      valid = false;
      continue;
    }
    const taskValue = taskValues[index];
    const task =
      taskValue === undefined ? undefined : taskSummary(taskValues[index]);
    if (taskValue !== undefined && !task) valid = false;
    outcomes.push({
      task,
      outcome: parsed.data.outcome,
      status: parsed.data.status,
      message: parsed.data.message,
    });
  }
  return {
    tasks: outcomes.flatMap((outcome) => (outcome.task ? [outcome.task] : [])),
    outcomes,
    previewUnavailable: !valid,
  };
}

export function parseTaskStatusResult(
  rawResult: unknown,
): ParsedTaskStatusResult {
  const compact = taskStatusToolResultPreviewSchema.safeParse(rawResult);
  if (compact.success) {
    return { tasks: compact.data.tasks, previewUnavailable: false };
  }
  const parsed = taskSummaries(record(rawResult).tasks);
  return { tasks: parsed.tasks, previewUnavailable: !parsed.valid };
}

export function parseTaskLogsResult(rawResult: unknown): ParsedTaskLogsResult {
  const compact = taskLogsToolResultPreviewSchema.safeParse(rawResult);
  if (compact.success) {
    return {
      task: compact.data.task,
      events: compact.data.events,
      nextCursor: compact.data.nextCursor,
      mode: compact.data.mode,
      previewUnavailable: false,
    };
  }

  const result = record(rawResult);
  const task = taskSummary(result.task);
  const events = logEvents(result.events);
  const nextCursor =
    typeof result.nextCursor === "number" &&
    Number.isInteger(result.nextCursor) &&
    result.nextCursor >= 0
      ? result.nextCursor
      : undefined;
  const mode = typeof result.mode === "string" ? result.mode : undefined;
  return {
    task,
    events: events.events,
    nextCursor,
    mode,
    previewUnavailable:
      !task || !events.valid || nextCursor === undefined || mode === undefined,
  };
}
