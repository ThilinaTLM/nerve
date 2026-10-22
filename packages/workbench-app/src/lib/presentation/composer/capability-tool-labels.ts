import type {
  CapabilitySelection,
  CapabilityToolName,
} from "@nervekit/contracts/capabilities";

export type CapabilityToolGroup = {
  key: string;
  label: string;
  names: CapabilityToolName[];
  searchText?: string;
};

/** Each conversation row controls one concrete capability independently. */
const capabilityToolCatalog: CapabilityToolGroup[] = [
  { key: "subagents", label: "Sub-agents", names: ["subagents"] },
  { key: "web_search", label: "Web search", names: ["web_search"] },
  { key: "web_fetch", label: "Web fetch", names: ["web_fetch"] },
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
  {
    key: "kroki_export",
    label: "Diagram export",
    names: ["kroki_export"],
  },
  { key: "bash", label: "Shell", names: ["bash"] },
  { key: "python_exec", label: "Python", names: ["python_exec"] },
  { key: "plan_present", label: "Plan review", names: ["plan_present"] },
  { key: "jira", label: "Jira", names: ["jira"] },
  { key: "confluence", label: "Confluence", names: ["confluence"] },
];

/** Only display whitelisted, non-secret effective configuration fields. */
export function capabilityToolSummary(
  selection: CapabilitySelection,
  name: CapabilityToolName,
): string | undefined {
  const settings = selection.toolSettings;
  switch (name) {
    case "bash":
      return `${settings.bash.shellPath || "Default shell"} · timeout ${settings.bash.maxTimeoutMs / 1000} s`;
    case "python_exec":
      return settings.python_exec.interpreterPath || "Auto-detect interpreter";
    case "explain_image":
      return settings.explain_image.model?.modelId || "No model selected";
    case "generate_image":
      return settings.generate_image.model;
    case "kroki_export":
      return "Diagram server configured";
    case "plan_present":
      return settings.plan_present.approvalProfile
        ? "Approval profile configured"
        : "No approval profile";
    default:
      return undefined;
  }
}

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
