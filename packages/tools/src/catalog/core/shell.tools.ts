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
      "Run a finite shell command. Long commands may be promoted to a background task; use timeout to cap runtime.",
    promptSnippet: "Run awaited shell commands",
    promptGuidelines: [
      "Prefer read/grep/find/ls over shell for file inspection and search.",
      "Use bash for finite checks, tests, and builds.",
    ],
    parameters: bashParameters,
    executionMode: "sequential",
  },
] satisfies CoreToolDefinition[];
