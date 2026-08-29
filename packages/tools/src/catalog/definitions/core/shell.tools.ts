import type { ToolRisk } from "@nervekit/contracts/permissions";
import { Type } from "typebox";
import { executeBash } from "../../../execution/shell/bash.js";
import { assessShellCommand } from "../../../policy/shell/assessment.js";
import type { ToolDefinition } from "../../contracts.js";

const bashParameters = Type.Object(
  {
    command: Type.String({ description: "Bash-compatible command to execute" }),
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
  },
  { additionalProperties: false },
);

function classifyCommandRisk(args: Record<string, unknown>): ToolRisk {
  const command = typeof args.command === "string" ? args.command : "";
  return assessShellCommand(command).risk;
}

export const shellToolDefinitions = [
  {
    name: "bash",
    group: "shell",
    baseRisk: "command",
    permission: {
      durableAllow: "target",
      targets: [{ kind: "command_segments", argument: "command" }],
    },
    traits: ["write_capable"],
    executionKind: "local",
    executor: executeBash,
    classifyRisk: classifyCommandRisk,
    label: "bash",
    description:
      "Run one finite synchronous command; use task_start for servers and watchers.",
    parameters: bashParameters,
    executionMode: "sequential",
  },
] satisfies ToolDefinition[];
