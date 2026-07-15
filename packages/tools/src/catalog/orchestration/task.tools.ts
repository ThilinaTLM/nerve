import type { ToolRisk } from "@nervekit/contracts";
import { Type } from "typebox";
import { hasDangerousCommandPattern } from "../../safety/command-policy.js";
import type { CoreToolDefinition } from "../types.js";

const taskStartItemParameters = Type.Object(
  {
    name: Type.Optional(Type.String({ description: "Stable task name" })),
    cwd: Type.Optional(
      Type.String({ description: "Working directory relative to the project" }),
    ),
    command: Type.String({
      description: "Bash-compatible command to start and supervise",
    }),
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
      Type.String({
        description: "Bash-compatible command to start and supervise",
      }),
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

function classifyTaskStartRisk(args: Record<string, unknown>): ToolRisk {
  const commands: string[] = [];
  if (typeof args.command === "string") commands.push(args.command);
  if (Array.isArray(args.tasks)) {
    for (const item of args.tasks) {
      if (item && typeof item === "object") {
        const command = (item as Record<string, unknown>).command;
        if (typeof command === "string") commands.push(command);
      }
    }
  }
  return commands.some(hasDangerousCommandPattern) ? "destructive" : "command";
}

export const taskToolDefinitions = [
  {
    name: "task_start",
    group: "taskManagement",
    baseRisk: "command",
    traits: ["write_capable", "long_running"],
    executionKind: "host",
    classifyRisk: classifyTaskStartRisk,
    label: "task_start",
    description:
      "Start supervised background tasks for servers, watchers, and other long-lived Bash-compatible commands.",
    promptSnippet:
      "Start detached background processes for long-lived commands and servers",
    promptGuidelines: [
      "Use task_start for servers, watchers, and other long-lived processes. Commands run in the same Bash-compatible shell runtime as bash.",
    ],
    parameters: taskStartParameters,
    executionMode: "sequential",
  },
  {
    name: "task_status",
    group: "taskManagement",
    baseRisk: "read",
    traits: [],
    executionKind: "host",
    label: "task_status",
    description:
      "Inspect task state once for diagnostics; not a wait mechanism.",
    promptSnippet: "Inspect current task status",
    promptGuidelines: [
      "Do not poll task_status/task_logs; inspect once when current task state matters.",
    ],
    parameters: taskStatusParameters,
    executionMode: "parallel",
  },
  {
    name: "task_logs",
    group: "taskManagement",
    baseRisk: "read",
    traits: [],
    executionKind: "host",
    label: "task_logs",
    description:
      "Inspect captured task logs for recent output, errors, warnings, or first-failure context.",
    promptSnippet: "Inspect logs from background tasks",
    parameters: taskLogsParameters,
    executionMode: "parallel",
  },
  {
    name: "task_cancel",
    group: "taskManagement",
    baseRisk: "command",
    traits: ["write_capable"],
    executionKind: "host",
    label: "task_cancel",
    description:
      "Terminate a running or orphaned task by task ID/name or group.",
    promptSnippet:
      "Cancel supervised background tasks or clean up orphaned task records",
    parameters: taskTargetParameters,
    executionMode: "sequential",
  },
  {
    name: "task_restart",
    group: "taskManagement",
    baseRisk: "command",
    traits: ["write_capable", "long_running"],
    executionKind: "host",
    label: "task_restart",
    description:
      "Restart a task by ID or stable name, preserving stored launch settings.",
    promptSnippet:
      "Restart supervised background tasks while preserving stored env overrides",
    parameters: taskRestartParameters,
    executionMode: "sequential",
  },
  {
    name: "task_list",
    group: "taskManagement",
    baseRisk: "read",
    traits: [],
    executionKind: "host",
    label: "task_list",
    description:
      "List known background tasks in the current working directory and its descendants.",
    promptSnippet: "List background tasks",
    parameters: taskListParameters,
    executionMode: "parallel",
  },
] satisfies CoreToolDefinition[];
