import { Type } from "typebox";
import type { CoreToolDefinition } from "../types.js";

const pythonParameters = Type.Object(
  {
    code: Type.Optional(
      Type.String({ description: "Inline Python code to execute" }),
    ),
    path: Type.Optional(
      Type.String({
        description:
          "Path to a Python script file to execute (relative to cwd or absolute). Provide exactly one of code or path.",
      }),
    ),
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
    env: Type.Optional(
      Type.Record(Type.String(), Type.String(), {
        description:
          "Non-secret environment variable overrides for the Python process. Sensitive-looking keys are rejected.",
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
      "Execute inline Python code or a Python script file in the current working directory. Returns stdout, stderr, exit metadata, truncation details, and artifact paths. Large or overlong-line outputs are saved to a transcript file with compact bounded previews. Output is capped by line count, total byte budget, and per-line length. Optionally provide a timeout in seconds and non-secret env overrides.",
    promptSnippet:
      "Execute short Python snippets or a Python script file for parsing, calculations, data inspection, and one-off transformations.",
    promptGuidelines: [
      "Provide exactly one of code or path to the python tool.",
      "Use python with inline code for short Python snippets instead of wrapping Python in bash heredocs.",
      "If a Python script is large, write it to a temporary .py file and run python with path instead of sending a large inline code argument.",
      "The python tool has no stdin; do not write scripts that wait for input().",
      "Do not use python for long-running servers, watchers, or daemons; use task_start for those.",
      "Use env only for non-secret environment overrides; secrets must not be passed through python tool args.",
      'For large JSON, CSV, diagrams, or other generated outputs, write files under os.environ["NERVE_PYTHON_ARTIFACT_DIR"] and return the artifact path instead of dumping everything to stdout.',
      "If stdout/stderr is still large or contains overlong lines, the tool saves the combined process output to a transcript file and returns a compact bounded preview.",
      "In planning mode, python is guarded against workspace file writes; artifact writes under NERVE_PYTHON_ARTIFACT_DIR are allowed.",
    ],
    parameters: pythonParameters,
    executionMode: "sequential",
  },
] satisfies CoreToolDefinition[];
