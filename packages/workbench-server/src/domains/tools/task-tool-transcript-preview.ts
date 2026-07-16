import {
  taskCancelResultSchema,
  taskLogsToolResultPreviewSchema,
  taskLogEventSchema,
  taskRecordSchema,
  taskRestartToolResultPreviewSchema,
  taskStartToolResultPreviewSchema,
  taskStatusToolResultPreviewSchema,
  taskCancelToolResultPreviewSchema,
  type TaskCancelOutcomePreviewPayload,
  type TaskLogEvent,
  type TaskRecord,
  type TaskToolSummaryPayload,
  type ToolName,
} from "@nervekit/contracts";

const TASK_STATUS_PREVIEW_COUNT = 5;
const TASK_CANCEL_PREVIEW_COUNT = 3;
const TASK_LOG_PREVIEW_COUNT = 10;

const NAME_MAX_BYTES = 96;
const CWD_MAX_BYTES = 192;
const COMMAND_MAX_BYTES = 256;
const READINESS_MAX_BYTES = 192;
const MESSAGE_MAX_BYTES = 256;
const LOG_LINE_MAX_BYTES = 512;
const PREVIEW_PATH_MAX_BYTES = 512;

const CREDENTIAL_URL = /^[a-z][a-z0-9+.-]*:\/\/[^/\s]*@/i;

type TaskToolName = Extract<
  ToolName,
  "task_start" | "task_status" | "task_logs" | "task_cancel" | "task_restart"
>;

export type TaskToolPreviewOverflow = {
  hidden: number;
  noun: "tasks" | "events";
  direction: "head" | "tail";
};

export type TaskToolTranscriptPreview = {
  resultPreview?: unknown;
  overflow?: TaskToolPreviewOverflow;
  valid: boolean;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function boundedUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  const suffix = "…";
  const suffixBytes = Buffer.byteLength(suffix, "utf8");
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (
      Buffer.byteLength(value.slice(0, middle), "utf8") <=
      maxBytes - suffixBytes
    ) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  if (low > 0 && /[\uD800-\uDBFF]/.test(value[low - 1] ?? "")) low -= 1;
  return `${value.slice(0, low)}${suffix}`;
}

export function taskToolSummary(
  value: unknown,
): TaskToolSummaryPayload | undefined {
  const parsed = taskRecordSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const task = parsed.data;
  const termination = taskTermination(task);
  const lineage = taskLineage(task);
  const readyUrl =
    task.readiness.readyUrl && !CREDENTIAL_URL.test(task.readiness.readyUrl)
      ? boundedUtf8(task.readiness.readyUrl, READINESS_MAX_BYTES)
      : undefined;
  return {
    id: task.id,
    name: task.name ? boundedUtf8(task.name, NAME_MAX_BYTES) : undefined,
    cwd: boundedUtf8(task.cwd, CWD_MAX_BYTES),
    command: boundedUtf8(task.command, COMMAND_MAX_BYTES),
    status: task.status,
    readiness: {
      outcome: task.readiness.outcome,
      readyUrl,
      readyOnUrl: task.readiness.readyOnUrl,
      matched: task.readiness.matched
        ? boundedUtf8(task.readiness.matched, READINESS_MAX_BYTES)
        : undefined,
    },
    timing: {
      startedAt: task.startedAt,
      finishedAt: task.finishedAt,
    },
    termination,
    lineage,
  };
}

function taskTermination(
  task: TaskRecord,
): TaskToolSummaryPayload["termination"] {
  if (
    task.exitCode === undefined &&
    task.signal === undefined &&
    task.error === undefined
  ) {
    return undefined;
  }
  return {
    exitCode: task.exitCode,
    signal: task.signal,
    error: task.error ? boundedUtf8(task.error, MESSAGE_MAX_BYTES) : undefined,
  };
}

function taskLineage(task: TaskRecord): TaskToolSummaryPayload["lineage"] {
  if (!task.groupId && !task.restartedFromTaskId) return undefined;
  return {
    groupId: task.groupId,
    restartedFromTaskId: task.restartedFromTaskId,
  };
}

function summaries(values: unknown[]): TaskToolSummaryPayload[] | undefined {
  const output: TaskToolSummaryPayload[] = [];
  for (const value of values) {
    const task = taskToolSummary(value);
    if (!task) return undefined;
    output.push(task);
  }
  return output;
}

function logEvent(value: unknown): TaskLogEvent | undefined {
  const parsed = taskLogEventSchema.safeParse(value);
  if (!parsed.success) return undefined;
  return {
    ...parsed.data,
    line: boundedUtf8(parsed.data.line, LOG_LINE_MAX_BYTES),
  };
}

function overflow(
  total: number,
  visible: number,
  noun: TaskToolPreviewOverflow["noun"],
  direction: TaskToolPreviewOverflow["direction"],
): TaskToolPreviewOverflow | undefined {
  const hidden = Math.max(0, total - visible);
  return hidden > 0 ? { hidden, noun, direction } : undefined;
}

export function buildTaskToolTranscriptPreview(
  toolName: TaskToolName,
  result: unknown,
): TaskToolTranscriptPreview {
  if (result === undefined) return { resultPreview: undefined, valid: true };
  const resultRecord = record(result);

  switch (toolName) {
    case "task_start": {
      const task = taskToolSummary(resultRecord.task);
      if (!task) return { valid: false };
      const resultPreview = { task };
      return {
        resultPreview,
        valid:
          taskStartToolResultPreviewSchema.safeParse(resultPreview).success,
      };
    }

    case "task_status": {
      const source = array(resultRecord.tasks);
      const selected = source.slice(0, TASK_STATUS_PREVIEW_COUNT);
      const tasks = summaries(selected);
      if (!tasks) return { valid: false };
      const resultPreview = { tasks };
      return {
        resultPreview,
        overflow: overflow(source.length, selected.length, "tasks", "head"),
        valid:
          taskStatusToolResultPreviewSchema.safeParse(resultPreview).success,
      };
    }

    case "task_logs": {
      const task = taskToolSummary(resultRecord.task);
      if (!task) return { valid: false };
      const source = array(resultRecord.events);
      const selected = source.slice(-TASK_LOG_PREVIEW_COUNT);
      const events = selected.map(logEvent);
      if (events.some((event) => event === undefined)) return { valid: false };
      const resultPreview = {
        task,
        events: events as TaskLogEvent[],
        nextCursor: resultRecord.nextCursor,
        mode: resultRecord.mode,
        previewPath:
          typeof resultRecord.previewPath === "string"
            ? boundedUtf8(resultRecord.previewPath, PREVIEW_PATH_MAX_BYTES)
            : undefined,
        truncated:
          typeof resultRecord.truncated === "boolean"
            ? resultRecord.truncated
            : undefined,
      };
      return {
        resultPreview,
        overflow: overflow(source.length, selected.length, "events", "tail"),
        valid: taskLogsToolResultPreviewSchema.safeParse(resultPreview).success,
      };
    }

    case "task_cancel": {
      const taskValues = array(resultRecord.tasks);
      const resultValues = array(resultRecord.cancelResults);
      const selectedResults = resultValues.slice(0, TASK_CANCEL_PREVIEW_COUNT);
      const outcomes: TaskCancelOutcomePreviewPayload[] = [];
      for (let index = 0; index < selectedResults.length; index += 1) {
        const parsed = taskCancelResultSchema.safeParse(selectedResults[index]);
        if (!parsed.success) return { valid: false };
        const taskValue = taskValues[index];
        const task =
          taskValue === undefined ? undefined : taskToolSummary(taskValue);
        if (taskValue !== undefined && !task) return { valid: false };
        outcomes.push({
          task,
          outcome: parsed.data.outcome,
          status: parsed.data.status,
          message: boundedUtf8(parsed.data.message, MESSAGE_MAX_BYTES),
        });
      }
      const resultPreview = { outcomes };
      const total = Math.max(taskValues.length, resultValues.length);
      return {
        resultPreview,
        overflow: overflow(total, selectedResults.length, "tasks", "head"),
        valid:
          taskCancelToolResultPreviewSchema.safeParse(resultPreview).success,
      };
    }

    case "task_restart": {
      const task = taskToolSummary(resultRecord.task);
      if (!task) return { valid: false };
      const resultPreview = {
        task,
        restartedFromTaskId: resultRecord.restartedFromTaskId,
        newTaskId: resultRecord.newTaskId,
        restartRootTaskId: resultRecord.restartRootTaskId,
      };
      return {
        resultPreview,
        valid:
          taskRestartToolResultPreviewSchema.safeParse(resultPreview).success,
      };
    }
  }
}

export function isTaskToolResultPreview(
  toolName: TaskToolName,
  result: unknown,
): boolean {
  if (result === undefined) return true;
  switch (toolName) {
    case "task_start":
      return taskStartToolResultPreviewSchema.safeParse(result).success;
    case "task_status":
      return taskStatusToolResultPreviewSchema.safeParse(result).success;
    case "task_logs":
      return taskLogsToolResultPreviewSchema.safeParse(result).success;
    case "task_cancel":
      return taskCancelToolResultPreviewSchema.safeParse(result).success;
    case "task_restart":
      return taskRestartToolResultPreviewSchema.safeParse(result).success;
  }
}
