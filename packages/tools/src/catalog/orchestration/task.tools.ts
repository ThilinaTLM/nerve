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
    readyUrl: Type.Optional(
      Type.String({ description: "Explicit URL to poll until reachable" }),
    ),
    readyOnUrl: Type.Optional(
      Type.Boolean({ description: "Treat first detected URL as ready" }),
    ),
    readyPattern: Type.Optional(
      Type.String({ description: "Regex line that marks the task ready" }),
    ),
    readyTimeoutMs: Type.Optional(
      Type.Number({
        description:
          "Readiness wait timeout in milliseconds. Only applies when readyUrl, readyOnUrl, or readyPattern is provided; it does not stop the process.",
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
    notify: Type.Optional(
      Type.Boolean({
        description:
          "Send concise asynchronous task updates to the agent. Defaults to true for agent task tools; set false to opt out.",
        default: true,
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
    readyUrl: Type.Optional(
      Type.String({ description: "Explicit URL to poll until reachable" }),
    ),
    readyOnUrl: Type.Optional(
      Type.Boolean({ description: "Treat first detected URL as ready" }),
    ),
    readyPattern: Type.Optional(
      Type.String({ description: "Regex line that marks the task ready" }),
    ),
    readyTimeoutMs: Type.Optional(
      Type.Number({
        description:
          "Readiness wait timeout in milliseconds. Only applies when readyUrl, readyOnUrl, or readyPattern is provided; it does not stop the process.",
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
    notify: Type.Optional(
      Type.Boolean({
        description:
          "Send concise asynchronous task updates to the agent. Defaults to true for agent task tools; set false to opt out.",
        default: true,
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
    taskId: Type.Optional(
      Type.String({ description: "Task id or stable task name" }),
    ),
    groupId: Type.Optional(Type.String({ description: "Task group id" })),
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
    taskId: Type.String({ description: "Task id or stable task name" }),
  },
  { additionalProperties: false },
);

const taskStatusParameters = Type.Object(
  {
    taskId: Type.Optional(
      Type.String({ description: "Task id or stable task name" }),
    ),
    taskIds: Type.Optional(
      Type.Array(Type.String({ description: "Task id or stable task name" }), {
        maxItems: 20,
      }),
    ),
    groupId: Type.Optional(Type.String({ description: "Task group id" })),
    activeOnly: Type.Optional(
      Type.Boolean({ description: "Only active tasks" }),
    ),
    includeLogs: Type.Optional(
      Type.Boolean({ description: "Include a short relevant log tail" }),
    ),
    logLimit: Type.Optional(
      Type.Number({
        description: "Maximum log events to include per task",
        minimum: 1,
        maximum: 50,
      }),
    ),
    limit: Type.Optional(
      Type.Number({ description: "Maximum tasks", minimum: 1, maximum: 50 }),
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
    groupId: Type.Optional(
      Type.String({ description: "Task group id filter" }),
    ),
    limit: Type.Optional(Type.Number({ description: "Maximum tasks" })),
  },
  { additionalProperties: false },
);

const taskLogsParameters = Type.Object(
  {
    taskId: Type.Optional(
      Type.String({ description: "Task id or stable task name" }),
    ),
    groupId: Type.Optional(Type.String({ description: "Task group id" })),
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
      "Start one command, or a small batch of commands, as supervised detached background tasks. Use for dev servers, watchers, listeners, and other long-lived processes.",
    promptSnippet:
      "Start detached background processes for long-lived commands and servers",
    promptGuidelines: [
      "Use task_start for detached dev servers, watchers, listeners, and other long-lived processes that should keep running independently.",
      "Do not use task_start for finite tests/checks/builds; use bash and let it auto-promote if needed.",
      "After starting a task, continue independent work; do not poll task_status/task_logs to wait.",
      "Readiness checks are off unless you provide readyUrl, readyOnUrl, or readyPattern.",
      "Use timeoutMs only to cap detached task runtime; readyTimeoutMs only bounds readiness detection and does not stop the process.",
      "Use task_status/task_logs only for one-off inspection or debugging when the next action depends on current state.",
      "Use notify: false only when the process should be fully quiet/detached; use task_cancel to terminate persistent tasks.",
    ],
    parameters: taskStartParameters,
    executionMode: "sequential",
  },
  {
    name: "task_status",
    label: "task_status",
    description:
      "Inspect task state once for diagnostics. Not a wait mechanism. With no target, defaults to active tasks in this conversation, then recent tasks.",
    promptSnippet: "Inspect current task status",
    promptGuidelines: [
      "Do not call task_status repeatedly to wait for completion.",
      "For awaited finite commands, use bash instead of task_start; promoted bash commands send async terminal notifications.",
    ],
    parameters: taskStatusParameters,
    executionMode: "parallel",
  },
  {
    name: "task_logs",
    label: "task_logs",
    description:
      "Query captured logs from a task for debugging or requested output inspection, including recent output, errors, warnings, cursor-based updates, and first-failure context.",
    promptSnippet: "Inspect logs from background tasks",
    promptGuidelines: [
      "Use task_logs to inspect task output instead of restarting a running task just to see errors.",
      "Do not call task_logs repeatedly to wait for progress.",
      "Use full task_... IDs, stable task names, or group IDs; do not abbreviate IDs.",
    ],
    parameters: taskLogsParameters,
    executionMode: "parallel",
  },
  {
    name: "task_cancel",
    label: "task_cancel",
    description:
      "Terminate/clean up a running or orphaned task by task ID/name or active group. With no target, only cancels when exactly one active task exists in this conversation.",
    promptSnippet:
      "Cancel supervised background tasks or clean up orphaned task records",
    parameters: taskTargetParameters,
    executionMode: "sequential",
  },
  {
    name: "task_restart",
    label: "task_restart",
    description:
      "Restart a task by task ID or stable name, preserving encrypted env overrides and launch settings captured at start.",
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
