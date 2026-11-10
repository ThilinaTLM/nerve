import { Type } from "typebox";
import { executePython } from "../../../execution/python/python.js";
import type { ToolDefinition } from "../../contracts.js";

const pythonParameters = Type.Object(
  {
    code: Type.Optional(Type.String()),
    path: Type.Optional(Type.String()),
    cwd: Type.Optional(Type.String()),
    timeout: Type.Optional(
      Type.Integer({
        default: 60,
        description: "Seconds; capped at 600.",
      }),
    ),
    env: Type.Optional(
      Type.Record(Type.String(), Type.String(), {
        description: "Non-secret only; sensitive keys are rejected.",
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
    permission: { durableAllow: "never" },
    traits: ["write_capable"],
    executionKind: "local",
    executor: executePython,
    label: "python_exec",
    description:
      "Run Python from `code` or a script `path`; output is bounded. Save large outputs under `$NERVE_PYTHON_ARTIFACT_DIR`. Not for long-lived or interactive processes.",
    parameters: pythonParameters,
    executionMode: "sequential",
  },
] satisfies ToolDefinition[];
