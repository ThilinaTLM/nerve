import type { ToolRisk } from "@nervekit/contracts";
import { Type } from "typebox";
import { executeBash } from "../../execution/shell/bash.js";
import {
  hasDangerousCommandPattern,
  isKnownReadOnlyCommand,
} from "../../safety/command-policy.js";
import type { ToolDefinition } from "../types.js";

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
  if (hasDangerousCommandPattern(command)) return "destructive";
  if (isKnownReadOnlyCommand(command)) return "read";
  return "command";
}

export const shellToolDefinitions = [
  {
    name: "bash",
    group: "shell",
    baseRisk: "command",
    traits: ["write_capable"],
    executionKind: "local",
    executor: executeBash,
    classifyRisk: classifyCommandRisk,
    label: "bash",
    description:
      "Run a finite Bash-compatible command; long commands may become supervised tasks.",
    parameters: bashParameters,
    executionMode: "sequential",
  },
] satisfies ToolDefinition[];
