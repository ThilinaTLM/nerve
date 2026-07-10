import { toolDefinitionsByGroup, toolGroups } from "@nervekit/agent-tools";
import type { SandboxConfigV1, ToolGroupStatus } from "@nervekit/contracts";

export function computeToolGroupStatus(
  config: SandboxConfigV1,
  runtime: { readOnly?: boolean; unavailable?: string[] } = {},
): ToolGroupStatus[] {
  const configuredGroups = config.tools?.groups ?? {};
  const unavailable = new Set(runtime.unavailable ?? []);

  return toolGroups.map((group) => {
    const definitions = toolDefinitionsByGroup(group);
    const manifestNames = definitions.map((definition) => definition.name);
    const conf = (
      configuredGroups as Record<
        string,
        {
          enabled?: boolean;
          tools?: { enabled?: string[]; disabled?: string[] };
          credential?: { type: string };
        }
      >
    )[group];
    const configured = group in configuredGroups;
    const active =
      conf?.enabled !== false &&
      (!runtime.readOnly ||
        group === "fileInspection" ||
        group === "explore") &&
      (config.agent.defaultPermissionLevel !== "read_only" ||
        group === "fileInspection" ||
        group === "explore");
    const enabled = conf?.tools?.enabled
      ? manifestNames.filter((name) => conf.tools?.enabled?.includes(name))
      : manifestNames;
    const disabled = new Set(conf?.tools?.disabled ?? []);
    const selected = enabled.filter((name) => !disabled.has(name));

    return {
      group,
      configured,
      active,
      tools: selected.filter((name) => !unavailable.has(name)),
      unavailableTools: selected.filter((name) => unavailable.has(name)),
      credentialType: conf?.credential?.type as
        | ToolGroupStatus["credentialType"]
        | undefined,
    };
  });
}
