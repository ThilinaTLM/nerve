import { Type } from "typebox";
import type { CoreToolDefinition } from "../types.js";

const taskStartItemParameters = Type.Object(
  {
    name: Type.Optional(Type.String({ description: "Stable task name" })),
    cwd: Type.Optional(
      Type.String({ description: "Working directory relative to the project" }),
    ),
    command: Type.String({ description: "Command to start and supervise" }),
    env: Type.Optional(
      Type.Record(Type.String(), Type.String(), {
        description:
          "Extra environment variables. Values are stored encrypted for restart and shown only as redacted keys.",
      }),
    ),
    readyOnUrl: Type.Optional(
      Type.Boolean({ description: "Treat first detected URL as ready" }),
    ),
    readyPattern: Type.Optional(
      Type.String({ description: "Regex line that marks the task ready" }),
    ),
    readyTimeoutMs: Type.Optional(
      Type.Number({
        description: "Readiness wait timeout in milliseconds",
        minimum: 0,
        maximum: 60_000,
      }),
    ),
    timeoutMs: Type.Optional(
      Type.Number({
        description: "Maximum task runtime in milliseconds",
        minimum: 1,
        maximum: 86_400_000,
      }),
    ),
    injectCompletion: Type.Optional(
      Type.Boolean({
        description: "Inject a completion summary into the agent conversation",
      }),
    ),
  },
  { additionalProperties: false },
);

const taskStartParameters = Type.Object(
  {
    name: Type.Optional(Type.String({ description: "Stable task name" })),
    cwd: Type.Optional(
      Type.String({ description: "Working directory relative to the project" }),
    ),
    command: Type.Optional(
      Type.String({ description: "Command to start and supervise" }),
    ),
    env: Type.Optional(
      Type.Record(Type.String(), Type.String(), {
        description:
          "Extra environment variables. Values are stored encrypted for restart and shown only as redacted keys.",
      }),
    ),
    readyOnUrl: Type.Optional(
      Type.Boolean({ description: "Treat first detected URL as ready" }),
    ),
    readyPattern: Type.Optional(
      Type.String({ description: "Regex line that marks the task ready" }),
    ),
    readyTimeoutMs: Type.Optional(
      Type.Number({
        description: "Readiness wait timeout in milliseconds",
        minimum: 0,
        maximum: 60_000,
      }),
    ),
    timeoutMs: Type.Optional(
      Type.Number({
        description: "Maximum task runtime in milliseconds",
        minimum: 1,
        maximum: 86_400_000,
      }),
    ),
    injectCompletion: Type.Optional(
      Type.Boolean({
        description: "Inject a completion summary into the agent conversation",
      }),
    ),
    tasks: Type.Optional(
      Type.Array(taskStartItemParameters, {
        maxItems: 8,
        description: "Small batch of tasks to start in the background",
      }),
    ),
  },
  { additionalProperties: false },
);

const taskTargetParameters = Type.Object(
  {
    taskId: Type.String({ description: "Task id" }),
    signal: Type.Optional(
      Type.Union([
        Type.Literal("SIGTERM"),
        Type.Literal("SIGINT"),
        Type.Literal("SIGKILL"),
      ]),
    ),
    timeoutMs: Type.Optional(
      Type.Number({
        description: "Cancel timeout in milliseconds",
        minimum: 1,
        maximum: 30_000,
      }),
    ),
    reason: Type.Optional(Type.String({ description: "Cancellation reason" })),
  },
  { additionalProperties: false },
);

const taskRestartParameters = Type.Object(
  {
    taskId: Type.String({ description: "Task id" }),
  },
  { additionalProperties: false },
);

const taskStatusParameters = Type.Object(
  {
    taskId: Type.Optional(Type.String({ description: "Task id" })),
    taskIds: Type.Optional(
      Type.Array(Type.String({ description: "Task id" }), {
        maxItems: 20,
      }),
    ),
    includeLogs: Type.Optional(
      Type.Boolean({ description: "Include a short recent log tail" }),
    ),
    logLimit: Type.Optional(
      Type.Number({
        description: "Maximum recent log events to include",
        minimum: 1,
        maximum: 50,
      }),
    ),
  },
  { additionalProperties: false },
);

const taskListParameters = Type.Object(
  {
    status: Type.Optional(Type.String({ description: "Task status filter" })),
    activeOnly: Type.Optional(
      Type.Boolean({ description: "Only active tasks" }),
    ),
    projectId: Type.Optional(Type.String({ description: "Project id filter" })),
    conversationId: Type.Optional(
      Type.String({ description: "Conversation id filter" }),
    ),
    agentId: Type.Optional(Type.String({ description: "Agent id filter" })),
    limit: Type.Optional(Type.Number({ description: "Maximum tasks" })),
  },
  { additionalProperties: false },
);

const taskLogsParameters = Type.Object(
  {
    taskId: Type.String({ description: "Task id" }),
    mode: Type.Optional(
      Type.Union([
        Type.Literal("recent"),
        Type.Literal("errors"),
        Type.Literal("warnings"),
        Type.Literal("since_cursor"),
        Type.Literal("first_failure"),
      ]),
    ),
    sinceSeq: Type.Optional(
      Type.Number({ description: "Cursor sequence", minimum: 0 }),
    ),
    contains: Type.Optional(Type.String({ description: "Substring filter" })),
    regex: Type.Optional(Type.String({ description: "Regex filter" })),
    contextLines: Type.Optional(
      Type.Number({ description: "Context lines", minimum: 0, maximum: 20 }),
    ),
    limit: Type.Optional(
      Type.Number({ description: "Maximum events", minimum: 1, maximum: 500 }),
    ),
  },
  { additionalProperties: false },
);

export const taskToolDefinitions = [
  {
    name: "task_start",
    label: "task_start",
    description:
      "Start one command, or a small batch of commands, as background tasks and return task IDs immediately. Captures logs and readiness state for task_status/task_logs queries.",
    promptSnippet:
      "Start background command tasks with supervised logs and lifecycle management",
    promptGuidelines: [
      "Use task_start for tests, builds, dev servers, watchers, long commands, and commands whose result is not needed before continuing.",
      "After starting a task, continue independent work instead of polling immediately unless the next action truly depends on it.",
      "Use timeoutMs for finite test/build jobs that should not run indefinitely; use readyTimeoutMs only for readiness checks.",
      "Use task_status or task_list before reporting current task state because old transcript status may be stale.",
      "Use task_logs for output and task_cancel to terminate a running task.",
    ],
    parameters: taskStartParameters,
    executionMode: "sequential",
  },
  {
    name: "task_status",
    label: "task_status",
    description:
      "Inspect the current status/result for one or more task IDs, optionally including a short recent log tail.",
    promptSnippet: "Inspect current task status",
    parameters: taskStatusParameters,
    executionMode: "parallel",
  },
  {
    name: "task_logs",
    label: "task_logs",
    description:
      "Query captured logs from a task, including recent output, errors, warnings, cursor-based updates, and first-failure context.",
    promptSnippet: "Inspect logs from background tasks",
    promptGuidelines: [
      "Use task_logs to inspect task output instead of restarting a running task just to see errors.",
      "Use full task_... IDs; do not abbreviate them.",
    ],
    parameters: taskLogsParameters,
    executionMode: "parallel",
  },
  {
    name: "task_cancel",
    label: "task_cancel",
    description: "Terminate/clean up a running or orphaned task by task ID.",
    promptSnippet:
      "Cancel supervised background tasks or clean up orphaned task records",
    parameters: taskTargetParameters,
    executionMode: "sequential",
  },
  {
    name: "task_restart",
    label: "task_restart",
    description:
      "Restart a task by task ID, preserving encrypted env overrides and launch settings captured at start.",
    promptSnippet:
      "Restart supervised background tasks while preserving stored env overrides",
    parameters: taskRestartParameters,
    executionMode: "sequential",
  },
  {
    name: "task_list",
    label: "task_list",
    description: "List known background tasks for the current project.",
    promptSnippet: "List background tasks",
    parameters: taskListParameters,
    executionMode: "parallel",
  },
] satisfies CoreToolDefinition[];
