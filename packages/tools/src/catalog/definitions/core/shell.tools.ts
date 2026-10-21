import { defaultSettings } from "@nervekit/contracts/settings";
import type { ToolRisk } from "@nervekit/contracts/permissions";
import { Type } from "typebox";
import { executeBash } from "../../../execution/shell/bash.js";
import { assessShellCommand } from "../../../policy/shell/assessment.js";
import type { LocalToolDefinition, ToolDefinition } from "../../contracts.js";

const projectEnvironmentParameter = Type.Optional(
  Type.Boolean({
    description: "False skips project environment activation.",
  }),
);

export type BashToolSettings = {
  autoPromotion: { enabled: boolean; afterMs: number };
  maxTimeoutMs: number;
};
export function buildBashToolDefinition(
  settings: BashToolSettings,
): LocalToolDefinition {
  const maxS = Math.floor(settings.maxTimeoutMs / 1000);
  return {
    ...shellToolDefinitions[0],
    parameters: Type.Object(
      {
        command: Type.String({ minLength: 1 }),
        cwd: Type.Optional(
          Type.String({
            description: "Must resolve inside the project.",
          }),
        ),
        projectEnvironment: projectEnvironmentParameter,
        background: Type.Optional(Type.Boolean()),
        ready: Type.Optional(Type.String()),
        ...(!settings.autoPromotion.enabled
          ? { timeout: Type.Integer({ minimum: 1, maximum: maxS }) }
          : {}),
      },
      { additionalProperties: false },
    ),
    description: bashDescription(settings),
  };
}
function bashDescription(settings: BashToolSettings): string {
  const afterS = settings.autoPromotion.afterMs / 1000;
  const maxS = Math.floor(settings.maxTimeoutMs / 1000);
  const background = settings.autoPromotion.enabled
    ? `Moves to the background after ${afterS}s (\`background: true\` returns at once)`
    : `Requires timeout (max ${maxS}s); the process is killed when it expires. \`background: true\` returns at once`;
  return `Run a shell command in the project. Prefer read/grep/find/ls for inspection and launch for the user's servers. ${background}; background runs notify you on exit, so don't poll. Large output is saved to files for read/grep.`;
}

const bashParameters = Type.Object(
  {
    command: Type.String({ minLength: 1 }),
    cwd: Type.Optional(
      Type.String({
        description: "Must resolve inside the project.",
      }),
    ),
    projectEnvironment: projectEnvironmentParameter,
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
    description: bashDescription(defaultSettings.tools.bash),
    parameters: bashParameters,
    executionMode: "sequential",
  },
] satisfies ToolDefinition[];
