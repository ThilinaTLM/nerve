import { Type } from "typebox";
import type { CoreToolDefinition } from "../types.js";

const pythonParameters = Type.Object(
  {
    code: Type.String({ description: "Python code to execute" }),
    cwd: Type.Optional(
      Type.String({
        description:
          "Working directory relative to the project directory. Defaults to the project directory.",
      }),
    ),
    timeout: Type.Optional(
      Type.Number({
        description: "Timeout in seconds, capped by the executor",
      }),
    ),
  },
  { additionalProperties: false },
);

export const pythonToolDefinitions = [
  {
    name: "python",
    label: "python",
    description:
      "Execute Python code in the current working directory. Returns stdout and stderr. Optionally provide a timeout in seconds.",
    promptSnippet:
      "Execute short Python snippets for parsing, calculations, data inspection, and one-off transformations.",
    promptGuidelines: [
      "Use python for short Python snippets instead of wrapping Python in bash heredocs.",
      "The python tool has no stdin; do not write scripts that wait for input().",
      "Do not use python for long-running servers, watchers, or daemons; use process_start for those.",
      "In planning mode, python is guarded against file writes and must not be used to mutate workspace files.",
    ],
    parameters: pythonParameters,
    executionMode: "sequential",
  },
] satisfies CoreToolDefinition[];
