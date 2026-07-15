import type { ToolRisk } from "@nervekit/contracts";
import { Type } from "typebox";
import { hasDangerousCommandPattern } from "../../safety/command-policy.js";
import type { CoreToolDefinition } from "../types.js";

const taskStartParameters = Type.Object(
  {
    name: Type.Optional(Type.String({ description: "Stable task name" })),
    cwd: Type.Optional(
      Type.String({ description: "Working directory relative to the project" }),
    ),
    command: Type.String({
      minLength: 1,
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

const taskStatusParameters = Type.Object(
  {
    taskId: Type.Optional(
      Type.String({ description: "Task ID or stable name" }),
    ),
    taskIds: Type.Optional(
      Type.Array(Type.String({ description: "Task ID or stable name" }), {
        minItems: 1,
        maxItems: 20,
      }),
    ),
    groupId: Type.Optional(Type.String({ description: "Task group ID" })),
    status: Type.Optional(
      Type.Union(
        [
          Type.Literal("active"),
          Type.Literal("all"),
          Type.Literal("starting"),
          Type.Literal("running"),
          Type.Literal("ready"),
          Type.Literal("stopping"),
          Type.Literal("completed"),
          Type.Literal("failed"),
          Type.Literal("timed_out"),
          Type.Literal("cancelled"),
          Type.Literal("orphaned"),
        ],
        { description: "Task state filter" },
      ),
    ),
    limit: Type.Optional(
      Type.Number({ description: "Maximum tasks", minimum: 1, maximum: 50 }),
    ),
  },
  { additionalProperties: false },
);

const taskLogsParameters = Type.Object(
  {
    taskId: Type.String({ description: "Task ID or stable name" }),
    mode: Type.Optional(
      Type.Union(
        [
          Type.Literal("recent"),
          Type.Literal("errors"),
          Type.Literal("warnings"),
          Type.Literal("since_cursor"),
          Type.Literal("first_failure"),
        ],
        {
          description:
            "Log query mode. first_failure returns diagnostic context around the first failure; since_cursor returns incremental output after sinceSeq.",
        },
      ),
    ),
    sinceSeq: Type.Optional(
      Type.Number({
        description: "Sequence cursor used by since_cursor",
        minimum: 0,
      }),
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

const taskCancelParameters = Type.Object(
  {
    taskId: Type.Optional(
      Type.String({ description: "Task ID or stable name" }),
    ),
    taskIds: Type.Optional(
      Type.Array(Type.String({ description: "Task ID or stable name" }), {
        minItems: 1,
        maxItems: 20,
      }),
    ),
    groupId: Type.Optional(Type.String({ description: "Task group ID" })),
    signal: Type.Optional(
      Type.Union([
        Type.Literal("SIGTERM"),
        Type.Literal("SIGINT"),
        Type.Literal("SIGKILL"),
      ]),
    ),
    timeoutMs: Type.Optional(
      Type.Number({
        description: "Cancellation timeout in milliseconds",
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
    taskId: Type.String({ description: "Task ID or stable name" }),
  },
  { additionalProperties: false },
);

function classifyTaskStartRisk(args: Record<string, unknown>): ToolRisk {
  return typeof args.command === "string" &&
    hasDangerousCommandPattern(args.command)
    ? "destructive"
    : "command";
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
      "Start one supervised background process for a server, watcher, or other long-lived Bash-compatible command.",
    promptSnippet: "Start one supervised long-lived background process",
    promptGuidelines: [
      "Use task_start for servers, watchers, and other known long-lived processes; use bash for finite commands. Rely on asynchronous terminal updates and do not poll task_status or task_logs.",
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
      "Discover tasks or inspect task state once. Defaults to active tasks in the current scope; explicit selectors include terminal tasks.",
    promptSnippet: "Discover tasks and inspect current task state",
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
      "Inspect one explicitly selected task's captured output for recent logs, diagnostics, warnings, or incremental output.",
    promptSnippet: "Inspect logs for one selected background task",
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
      "Cancel explicitly selected tasks by ID/name, ID/name array, or group.",
    promptSnippet: "Cancel explicitly selected supervised tasks",
    parameters: taskCancelParameters,
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
      "Restart one task by ID or stable name while preserving stored launch settings and environment.",
    promptSnippet:
      "Restart one supervised task with its stored launch settings",
    parameters: taskRestartParameters,
    executionMode: "sequential",
  },
] as const satisfies readonly CoreToolDefinition[];
