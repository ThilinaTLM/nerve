import { Type } from "typebox";
import { executePython } from "../../../execution/python/python.js";
import type { ToolDefinition } from "../../contracts.js";

const pythonParameters = Type.Object(
  {
    code: Type.Optional(
      Type.String({ description: "Exactly one of code or path." }),
    ),
    path: Type.Optional(
      Type.String({
        description: "Exactly one of code or path.",
      }),
    ),
    cwd: Type.Optional(Type.String()),
    timeout: Type.Optional(
      Type.Number({
        description: "Seconds, capped.",
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
      "Run inline Python or a script with bounded output. Save large outputs under `$NERVE_PYTHON_ARTIFACT_DIR`. Not for long-lived or interactive processes.",
    parameters: pythonParameters,
    executionMode: "sequential",
  },
] satisfies ToolDefinition[];
