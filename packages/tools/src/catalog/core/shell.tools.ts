import { Type } from "typebox";
import type { CoreToolDefinition } from "../types.js";

const bashParameters = Type.Object(
  {
    command: Type.String({ description: "Bash command to execute" }),
    timeout: Type.Optional(
      Type.Number({
        description: "Timeout in seconds, capped by the executor",
      }),
    ),
  },
  { additionalProperties: false },
);

export const shellToolDefinitions = [
  {
    name: "bash",
    label: "bash",
    description:
      "Execute an awaited bash command in the current working directory. Returns stdout and stderr. Finite commands may auto-promote after about 60 seconds and report completion asynchronously. Large outputs are saved to a transcript file with a compact preview. Optionally provide a timeout in seconds.",
    promptSnippet: "Run awaited shell commands",
    promptGuidelines: [
      "Use dedicated file tools when available: read for file contents, grep for content search, find for file discovery, and ls for directory listings.",
      "Use bash for finite shell work whose result matters, including tests/checks/builds even when they may take minutes.",
      "If bash auto-promotes, continue independent work or wait for the harness terminal notification; do not poll task_status just to wait.",
      "Use task_start only for detached dev servers, watchers, listeners, and other long-lived processes.",
    ],
    parameters: bashParameters,
    executionMode: "sequential",
  },
] satisfies CoreToolDefinition[];
