import type { ToolRisk } from "@nervekit/contracts";
import { Type } from "typebox";
import { executeBash } from "../../execution/shell/bash.js";
import {
  hasDangerousCommandPattern,
  isKnownReadOnlyCommand,
} from "../../safety/command-policy.js";
import type { CoreToolDefinition } from "../types.js";

const bashParameters = Type.Object(
  {
    command: Type.String({ description: "Bash-compatible command to execute" }),
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
      "Run a finite Bash-compatible shell command. On Windows, Nerve resolves bash.exe such as Git Bash. Long commands may be promoted to a background task; use timeout to cap runtime.",
    promptSnippet: "Run awaited shell commands",
    promptGuidelines: [
      "Prefer read/grep/find/ls over shell for file inspection and search.",
      "Use bash for finite checks, tests, and builds. Commands run in a Bash-compatible shell; on Windows this is typically Git Bash.",
    ],
    parameters: bashParameters,
    executionMode: "sequential",
  },
] satisfies CoreToolDefinition[];
