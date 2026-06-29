import { Type } from "typebox";
import type { CoreToolDefinition } from "../types.js";

const bashParameters = Type.Object(
  {
    command: Type.String({ description: "Bash-compatible command to execute" }),
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
      "Run a finite Bash-compatible shell command. On Windows, Nerve resolves bash.exe such as Git Bash. Long commands may be promoted to a background task; use timeout to cap runtime.",
    promptSnippet: "Run awaited shell commands",
    promptGuidelines: [
      "Prefer read/grep/find/ls over shell for file inspection and search.",
      "Use bash for finite checks, tests, and builds. Commands run in a Bash-compatible shell; on Windows this is typically Git Bash.",
    ],
    parameters: bashParameters,
    executionMode: "sequential",
  },
] satisfies CoreToolDefinition[];
