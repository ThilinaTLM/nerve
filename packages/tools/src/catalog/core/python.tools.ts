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
      "Execute Python code in the current working directory. Returns stdout, stderr, exit metadata, truncation details, and artifact paths. Optionally provide a timeout in seconds and non-secret env overrides.",
    promptSnippet:
      "Execute short Python snippets for parsing, calculations, data inspection, and one-off transformations.",
    promptGuidelines: [
      "Use python for short Python snippets instead of wrapping Python in bash heredocs.",
      "The python tool has no stdin; do not write scripts that wait for input().",
      "Do not use python for long-running servers, watchers, or daemons; use process_start for those.",
      "Use env only for non-secret environment overrides; secrets must not be passed through python tool args.",
      'For large JSON, CSV, diagrams, or other generated outputs, write files under os.environ["NERVE_PYTHON_ARTIFACT_DIR"] and return the artifact path instead of dumping everything to stdout.',
      "In planning mode, python is guarded against workspace file writes; artifact writes under NERVE_PYTHON_ARTIFACT_DIR are allowed.",
    ],
    parameters: pythonParameters,
    executionMode: "sequential",
  },
] satisfies CoreToolDefinition[];
