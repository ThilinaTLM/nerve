import type { CapabilityToolName } from "@nervekit/contracts/capabilities";

export type CapabilityToolGroup = {
  key: string;
  label: string;
  names: CapabilityToolName[];
  searchText?: string;
};

/**
 * Conversation-level rows mirror the capability families shown in Settings.
 * A family still patches every concrete tool name because capability documents
 * and runtime policy remain tool-specific.
 */
const capabilityToolCatalog: CapabilityToolGroup[] = [
  { key: "explore", label: "Explore", names: ["explore"] },
  { key: "subagents", label: "Async Subagents", names: ["subagents"] },
  {
    key: "web",
    label: "Web access",
    names: ["web_search", "web_fetch"],
    searchText: "Web search Web fetch",
  },
  {
    key: "explain_image",
    label: "Image explanation",
    names: ["explain_image"],
  },
  {
    key: "generate_image",
    label: "Generate Image",
    names: ["generate_image"],
  },
  { key: "python_exec", label: "Python", names: ["python_exec"] },
  { key: "jira", label: "Jira", names: ["jira"] },
  { key: "confluence", label: "Confluence", names: ["confluence"] },
];

export function capabilityToolGroupsFor(
  tools: readonly CapabilityToolName[],
): CapabilityToolGroup[] {
  const available = new Set(tools);
  const seen = new Set<string>();
  const groups: CapabilityToolGroup[] = [];
  for (const name of tools) {
    const group = capabilityToolCatalog.find((item) =>
      item.names.includes(name),
    );
    if (!group || seen.has(group.key)) continue;
    seen.add(group.key);
    groups.push({
      ...group,
      names: group.names.filter((item) => available.has(item)),
    });
  }
  return groups;
}
