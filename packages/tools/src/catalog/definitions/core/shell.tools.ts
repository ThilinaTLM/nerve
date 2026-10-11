import type { ToolRisk } from "@nervekit/contracts/permissions";
import { Type } from "typebox";
import { executeBash } from "../../../execution/shell/bash.js";
import { assessShellCommand } from "../../../policy/shell/assessment.js";
import type { LocalToolDefinition, ToolDefinition } from "../../contracts.js";

export type BashToolSettings = {
  autoPromotion: { enabled: boolean; afterMs: number };
  maxTimeoutMs: number;
};
export function buildBashToolDefinition(
  settings: BashToolSettings,
): LocalToolDefinition {
  const afterS = settings.autoPromotion.afterMs / 1000;
  const maxS = Math.floor(settings.maxTimeoutMs / 1000);
  return {
    ...shellToolDefinitions[0],
    parameters: Type.Object(
      {
        command: Type.String({ minLength: 1 }),
        cwd: Type.Optional(
          Type.String({
            description:
              "Project-relative or absolute; must resolve inside the project.",
          }),
        ),
        background: Type.Optional(Type.Boolean()),
        ready: Type.Optional(Type.String()),
        ...(!settings.autoPromotion.enabled
          ? { timeout: Type.Integer({ minimum: 1, maximum: maxS }) }
          : {}),
      },
      { additionalProperties: false },
    ),
    description: `Run a shell command. ${settings.autoPromotion.enabled ? `Moves to background after ${afterS}s if still running; background:true returns at once.` : `Requires timeout (max ${maxS}s); the process is killed when it expires. background:true returns at once.`} Background runs notify you on exit; don't poll. Large output is summarized with file paths for read/grep. Use launch for the user's dev servers.`,
  };
}
const bashParameters = Type.Object(
  {
    command: Type.String({ minLength: 1 }),
    cwd: Type.Optional(
      Type.String({
        description:
          "Project-relative or absolute; must resolve inside the project.",
      }),
    ),
    background: Type.Optional(Type.Boolean()),
    ready: Type.Optional(Type.String()),
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
      "Run a shell command. Moves to background after 120s if still running; background:true returns at once. Background runs notify you on exit; don't poll. Large output is summarized with file paths for read/grep. Use launch for the user's dev servers.",
    parameters: bashParameters,
    executionMode: "sequential",
  },
] satisfies ToolDefinition[];
