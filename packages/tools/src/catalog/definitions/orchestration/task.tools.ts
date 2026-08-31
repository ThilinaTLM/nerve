import type { ToolRisk } from "@nervekit/contracts/permissions";
import { Type } from "typebox";
import { hasDangerousCommandPattern } from "../../../policy/shell/plan-mode.js";
import type { ToolDefinition } from "../../contracts.js";

const readinessTimeout = Type.Optional(
  Type.Number({ minimum: 0, maximum: 60_000 }),
);

const taskStartParameters = Type.Object(
  {
    command: Type.String({
      minLength: 1,
      description: "Bash-compatible command to supervise",
    }),
    name: Type.Optional(Type.String({ description: "Stable task name" })),
    cwd: Type.Optional(
      Type.String({ description: "Working directory relative to the project" }),
    ),
    env: Type.Optional(
      Type.Record(Type.String(), Type.String(), {
        description:
          "Encrypted environment overrides; secret values stay redacted",
      }),
    ),
    ready: Type.Optional(
      Type.Union([
        Type.Object(
          {
            kind: Type.Literal("url"),
            url: Type.String(),
            timeoutMs: readinessTimeout,
          },
          { additionalProperties: false },
        ),
        Type.Object(
          {
            kind: Type.Literal("detected_url"),
            timeoutMs: readinessTimeout,
          },
          { additionalProperties: false },
        ),
        Type.Object(
          {
            kind: Type.Literal("pattern"),
            pattern: Type.String(),
            timeoutMs: readinessTimeout,
          },
          { additionalProperties: false },
        ),
      ]),
    ),
    timeoutMs: Type.Optional(Type.Number({ minimum: 1, maximum: 86_400_000 })),
  },
  { additionalProperties: false },
);

const taskStatusParameters = Type.Object(
  {
    tasks: Type.Optional(
      Type.Array(Type.String(), { minItems: 1, maxItems: 20 }),
    ),
    status: Type.Optional(
      Type.Union([
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
        Type.Literal("recovered"),
        Type.Literal("interrupted"),
        Type.Literal("recovery_unknown"),
      ]),
    ),
    limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50 })),
  },
  { additionalProperties: false },
);

const taskLogsParameters = Type.Object(
  {
    task: Type.String({ description: "Task ID or stable name" }),
    mode: Type.Optional(
      Type.Union([
        Type.Literal("recent"),
        Type.Literal("errors"),
        Type.Literal("warnings"),
        Type.Literal("since_cursor"),
        Type.Literal("first_failure"),
      ]),
    ),
    cursor: Type.Optional(Type.Number({ minimum: 0 })),
    contains: Type.Optional(Type.String({ description: "Substring filter" })),
    contextLines: Type.Optional(Type.Number({ minimum: 0, maximum: 20 })),
    limit: Type.Optional(Type.Number({ minimum: 1, maximum: 500 })),
  },
  { additionalProperties: false },
);

const taskControlParameters = Type.Object(
  {
    task: Type.String({ description: "Task ID or stable name" }),
    action: Type.Union([Type.Literal("stop"), Type.Literal("restart")]),
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
      "Start one durable, queryable process for a server, watcher, or other long-lived command.",
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
      "Inspect selected tasks, or list active tasks when none are selected.",
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
    description: "Inspect one task's bounded captured output.",
    parameters: taskLogsParameters,
    executionMode: "parallel",
  },
  {
    name: "task_control",
    group: "taskManagement",
    baseRisk: "command",
    traits: ["write_capable", "long_running"],
    executionKind: "host",
    label: "task_control",
    description:
      "Stop or restart one task; restart reuses stored launch settings.",
    parameters: taskControlParameters,
    executionMode: "sequential",
  },
] as const satisfies readonly ToolDefinition[];
