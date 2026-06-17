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
      "Execute a bash command in the current working directory. Returns stdout and stderr. Large outputs are saved to a transcript file with a compact preview. Optionally provide a timeout in seconds.",
    promptSnippet: "Execute bash commands (ls, grep, find, etc.)",
    parameters: bashParameters,
    executionMode: "sequential",
  },
] satisfies CoreToolDefinition[];
