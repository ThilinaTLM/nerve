import { Type } from "typebox";
import { executePython } from "../../execution/python/python.js";
import type { ToolDefinition } from "../types.js";

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
          "Working directory relative to the agent's current directory, or absolute. Defaults to the current directory.",
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
    name: "python_exec",
    group: "python",
    baseRisk: "command",
    traits: ["write_capable"],
    executionKind: "local",
    executor: executePython,
    label: "python_exec",
    description:
      "Execute inline Python or a script with bounded output and artifact support.",
    parameters: pythonParameters,
    executionMode: "sequential",
  },
] satisfies ToolDefinition[];
