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
      "Run a finite shell command in the current working directory. If it is still running after about 60 seconds, Nerve returns a background task id and sends an async update when it finishes. Use timeout to cap runtime.",
    promptSnippet: "Run awaited shell commands",
    promptGuidelines: [
      "Use dedicated file tools when available: read for file contents, grep for content search, find for file discovery, and ls for directory listings.",
      "Use bash for finite commands such as checks, tests, and builds.",
      "If bash promotes, continue useful work or inspect once with task_status/task_logs; do not poll just to wait.",
      "Use task_start for intentionally long-lived servers, watchers, listeners, and daemons.",
    ],
    parameters: bashParameters,
    executionMode: "sequential",
  },
] satisfies CoreToolDefinition[];
