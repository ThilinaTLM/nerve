import {
  emptyCapabilityOverrides,
  capabilityToolNameSchema,
  type CapabilityConfiguration,
  type CapabilityPatch,
  type CapabilityToolName,
} from "@nervekit/contracts/capabilities";
import { toolNameSchema } from "@nervekit/contracts/tools";
import type {
  AgentRecord,
  UpdateAgentRequest,
} from "@nervekit/contracts/agents";

export type AgentSkillOption = {
  name: string;
  kind: "file" | "nerve" | "agentBrowser";
  enabled: boolean;
};
function members(name: CapabilityToolName): string[] {
  if (name === "subagents")
    return toolNameSchema.options.filter((tool) =>
      tool.startsWith("subagent_"),
    );
  if (name === "jira" || name === "confluence")
    return toolNameSchema.options.filter((tool) => tool.startsWith(`${name}_`));
  return [name];
}
export function selectedAgentSkillNames(
  agent: Pick<AgentRecord, "skills">,
  inherited: readonly AgentSkillOption[],
): string[] {
  return agent.skills == null
    ? inherited.filter((skill) => skill.enabled).map((skill) => skill.name)
    : [...agent.skills];
}
export function agentCapabilityConfiguration(
  base: CapabilityConfiguration,
  agent: AgentRecord,
  skills: readonly AgentSkillOption[] = [],
): CapabilityConfiguration {
  const overrides = emptyCapabilityOverrides();
  if (agent.tools != null)
    for (const name of capabilityToolNameSchema.options)
      overrides.tools[name] = {
        enabled: members(name).some((tool) => agent.tools!.includes(tool)),
      };
  const selected = new Set(selectedAgentSkillNames(agent, skills));
  if (agent.skills != null)
    for (const skill of skills)
      overrides.skills[skill.kind][skill.name] = selected.has(skill.name);
  return {
    ...base,
    conversation: overrides,
    inherited: base.effective,
    effective: {
      ...base.effective,
      disabledTools:
        agent.tools == null
          ? base.effective.disabledTools
          : capabilityToolNameSchema.options.filter(
              (name) =>
                !members(name).some((tool) => agent.tools!.includes(tool)),
            ),
      ...(agent.skills == null
        ? {}
        : {
            disabledFileSkills: skills
              .filter(
                (skill) => skill.kind === "file" && !selected.has(skill.name),
              )
              .map((skill) => skill.name),
            enabledNerveSkills: skills
              .filter(
                (skill) => skill.kind === "nerve" && selected.has(skill.name),
              )
              .map((skill) => skill.name),
            enabledAgentBrowserSkills: skills
              .filter(
                (skill) =>
                  skill.kind === "agentBrowser" && selected.has(skill.name),
              )
              .map((skill) => skill.name),
          }),
    },
  };
}
/** Materialize the inherited selection before editing one item. Never change shared defaults. */
export function agentCapabilityPatch(
  agent: AgentRecord,
  patch: CapabilityPatch,
  inherited: readonly AgentSkillOption[] = [],
  base?: CapabilityConfiguration,
): UpdateAgentRequest {
  const result: UpdateAgentRequest = {};
  if (patch.tools) {
    const defaults = toolNameSchema.options.filter(
      (tool) =>
        !base?.effective.disabledTools.some((name) =>
          members(name).includes(tool),
        ),
    );
    const tools = new Set(agent.tools ?? defaults);
    for (const [name, edit] of Object.entries(patch.tools)) {
      if (edit?.enabled === undefined) continue;
      for (const tool of members(name as CapabilityToolName)) {
        const enabled =
          edit.enabled ??
          !base?.effective.disabledTools.includes(name as CapabilityToolName);
        if (enabled) tools.add(tool);
        else tools.delete(tool);
      }
    }
    if (Object.values(patch.tools).some((edit) => edit?.enabled !== undefined))
      result.tools = [...tools];
  }
  if (patch.skills) {
    const skills = new Set(selectedAgentSkillNames(agent, inherited));
    for (const group of Object.values(patch.skills))
      for (const [name, enabled] of Object.entries(group ?? {})) {
        const selected =
          enabled ??
          inherited.some((skill) => skill.name === name && skill.enabled);
        if (selected) skills.add(name);
        else skills.delete(name);
      }
    result.skills = [...skills];
  }
  return result;
}
