import type { ToolRisk } from "@nervekit/contracts/permissions";
import { Type } from "typebox";
import type { ToolDefinition } from "../../contracts.js";

const page = {
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
  limit: Type.Optional(
    Type.Integer({ minimum: 1, maximum: 500, default: 100 }),
  ),
};
function classifyProcessRisk(args: Record<string, unknown>): ToolRisk {
  return ["list", "status", "logs"].includes(String(args.action))
    ? "read"
    : "command";
}
export const processToolDefinitions = [
  {
    name: "async_bash",
    group: "process",
    baseRisk: "command",
    traits: ["write_capable"],
    executionKind: "host",
    label: "async_bash",
    classifyRisk: classifyProcessRisk,
    description:
      "Manage your background bash runs. list: running runs (`all: true` includes finished). logs: output from offset (default: tail). stop: kills the process tree.",
    parameters: Type.Object(
      {
        action: Type.Union([
          Type.Literal("list"),
          Type.Literal("logs"),
          Type.Literal("stop"),
        ]),
        all: Type.Optional(Type.Boolean()),
        id: Type.Optional(Type.String({ minLength: 1 })),
        ...page,
      },
      { additionalProperties: false },
    ),
    executionMode: "sequential",
  },
  {
    name: "launch",
    group: "process",
    baseRisk: "command",
    traits: ["write_capable"],
    executionKind: "host",
    label: "launch",
    classifyRisk: classifyProcessRisk,
    description:
      "Use the user's launch definitions (dev servers etc.); you can't create or edit them. Check status before starting. Select by exact name; `runId` targets one run (default: latest). logs: output from offset (default: tail).",
    parameters: Type.Object(
      {
        action: Type.Union([
          Type.Literal("status"),
          Type.Literal("logs"),
          Type.Literal("start"),
          Type.Literal("restart"),
          Type.Literal("stop"),
        ]),
        name: Type.Optional(Type.String({ minLength: 1 })),
        runId: Type.Optional(
          Type.String({
            minLength: 1,
          }),
        ),
        ...page,
      },
      { additionalProperties: false },
    ),
    executionMode: "sequential",
  },
] satisfies ToolDefinition[];
