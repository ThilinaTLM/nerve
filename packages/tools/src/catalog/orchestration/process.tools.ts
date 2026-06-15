import { Type } from "typebox";
import type { CoreToolDefinition } from "../types.js";

const processStartParameters = Type.Object(
  {
    name: Type.Optional(Type.String({ description: "Stable process name" })),
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
      Type.String({ description: "Regex line that marks the process ready" }),
    ),
    readyTimeoutMs: Type.Optional(
      Type.Number({ description: "Readiness wait timeout in milliseconds" }),
    ),
  },
  { additionalProperties: false },
);

const processTargetParameters = Type.Object(
  {
    processId: Type.Optional(Type.String({ description: "Process id" })),
    name: Type.Optional(Type.String({ description: "Process name" })),
    signal: Type.Optional(
      Type.Union([
        Type.Literal("SIGTERM"),
        Type.Literal("SIGINT"),
        Type.Literal("SIGKILL"),
      ]),
    ),
    timeoutMs: Type.Optional(
      Type.Number({ description: "Stop timeout in milliseconds" }),
    ),
  },
  { additionalProperties: false },
);

const processRestartParameters = Type.Object(
  {
    processId: Type.Optional(Type.String({ description: "Process id" })),
    name: Type.Optional(Type.String({ description: "Process name" })),
  },
  { additionalProperties: false },
);

const processListParameters = Type.Object({}, { additionalProperties: false });

const processLogsParameters = Type.Object(
  {
    processId: Type.Optional(Type.String({ description: "Process id" })),
    name: Type.Optional(Type.String({ description: "Process name" })),
    mode: Type.Optional(
      Type.Union([
        Type.Literal("recent"),
        Type.Literal("errors"),
        Type.Literal("warnings"),
        Type.Literal("since_cursor"),
        Type.Literal("first_failure"),
      ]),
    ),
    sinceSeq: Type.Optional(Type.Number({ description: "Cursor sequence" })),
    contains: Type.Optional(Type.String({ description: "Substring filter" })),
    regex: Type.Optional(Type.String({ description: "Regex filter" })),
    contextLines: Type.Optional(Type.Number({ description: "Context lines" })),
    limit: Type.Optional(Type.Number({ description: "Maximum events" })),
  },
  { additionalProperties: false },
);

export const processToolDefinitions = [
  {
    name: "process_start",
    label: "process_start",
    description:
      "Start a managed long-running command such as a dev server, watcher, or daemon. Captures logs and readiness state for later process_logs queries.",
    promptSnippet:
      "Start long-running commands with supervised logs and lifecycle management",
    promptGuidelines: [
      "Use process_start instead of bash for dev servers, file watchers, queue workers, and other long-running commands.",
      "Provide readyOnUrl or readyPattern when possible so the tool can wait for readiness.",
    ],
    parameters: processStartParameters,
    executionMode: "sequential",
  },
  {
    name: "process_stop",
    label: "process_stop",
    description:
      "Stop a managed process or clean up an orphaned process by processId or name.",
    promptSnippet:
      "Stop supervised long-running processes, including best-effort cleanup of orphaned process trees after daemon restarts",
    promptGuidelines: [
      "Use process_stop on orphaned records before restarting if a daemon restart may have left the old process tree alive.",
    ],
    parameters: processTargetParameters,
    executionMode: "sequential",
  },
  {
    name: "process_restart",
    label: "process_restart",
    description:
      "Restart a managed process by processId or name, preserving encrypted env overrides captured at start.",
    promptSnippet:
      "Restart supervised long-running processes while preserving stored env overrides",
    parameters: processRestartParameters,
    executionMode: "sequential",
  },
  {
    name: "process_list",
    label: "process_list",
    description: "List managed processes for the current project.",
    promptSnippet: "List supervised processes",
    parameters: processListParameters,
    executionMode: "parallel",
  },
  {
    name: "process_logs",
    label: "process_logs",
    description:
      "Query captured logs from a managed process, including recent output, errors, warnings, cursor-based updates, and first-failure context.",
    promptSnippet: "Inspect logs from supervised processes",
    promptGuidelines: [
      "After code changes that trigger a running process to recompile, inspect process_logs instead of restarting the command just to see errors.",
    ],
    parameters: processLogsParameters,
    executionMode: "parallel",
  },
] satisfies CoreToolDefinition[];
