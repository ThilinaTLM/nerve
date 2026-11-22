import {
  canonicalSettingsEntries,
  type LeadSettingsOverrides,
} from "@nervekit/contracts/agent-configuration";

/** Pages whose project overrides live in the project's `agent.json`. */
type AgentOverridePageId = "general" | "tools" | "skills" | "sub-agents";

const prefixByPage: Record<Exclude<AgentOverridePageId, "general">, string> = {
  tools: "/tools",
  skills: "/skills",
  "sub-agents": "/subagents",
};

function belongsTo(pageId: AgentOverridePageId, pointer: string): boolean {
  if (pageId !== "general")
    return pointer.startsWith(`${prefixByPage[pageId]}/`);
  // General owns everything the other pages do not.
  return !Object.values(prefixByPage).some((prefix) =>
    pointer.startsWith(`${prefix}/`),
  );
}

/** The project's own agent settings that sit on one page (JSON pointers below `/overrides`). */
export function agentOverridePointers(
  overrides: LeadSettingsOverrides,
  pageId: AgentOverridePageId,
): string[] {
  return canonicalSettingsEntries(overrides)
    .map(([pointer]) => pointer)
    .filter((pointer) => belongsTo(pageId, pointer));
}
