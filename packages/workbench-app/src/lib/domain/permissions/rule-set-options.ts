import type {
  PermissionRuleSetId,
  PermissionRuleSetSummary,
} from "@nervekit/contracts/permissions";

export const BUILT_IN_PERMISSION_RULE_SET_SUMMARIES: readonly PermissionRuleSetSummary[] =
  [
    {
      id: "baseline",
      name: "Baseline",
      description: "Prompt by default while allowing interaction boundaries.",
      source: "builtin",
      enabled: true,
      available: true,
    },
    {
      id: "read_only",
      name: "Read-only",
      description:
        "Allow interaction, local inspection and sub-agent delegation; deny all other capabilities.",
      source: "builtin",
      enabled: true,
      available: true,
    },
    {
      id: "supervised",
      name: "Supervise",
      description:
        "Allow interaction and local inspection; prompt for other capabilities.",
      source: "builtin",
      enabled: true,
      available: true,
    },
    {
      id: "autonomous",
      name: "Auto",
      description: "Allow every valid tool request.",
      source: "builtin",
      enabled: true,
      available: true,
    },
    {
      id: "planning",
      name: "Draft",
      description:
        "Allow reads, interaction, sub-agent delegation, and writes wholly within the plans directory.",
      source: "builtin",
      enabled: true,
      available: true,
    },
  ];

/** Every enabled rule set except Baseline, the foundation under all agents. */
export function selectablePermissionRuleSets(
  summaries: readonly PermissionRuleSetSummary[],
): PermissionRuleSetSummary[] {
  return summaries.filter(
    (summary) =>
      summary.id !== "baseline" && summary.available && summary.enabled,
  );
}

export function selectedPermissionRuleSetSummary(
  options: readonly PermissionRuleSetSummary[],
  selectedId: PermissionRuleSetId,
): PermissionRuleSetSummary {
  return (
    options.find((option) => option.id === selectedId) ?? {
      id: selectedId,
      name: selectedId,
      description: "This rule set is missing, disabled, or unavailable.",
      source: "user",
      enabled: false,
      available: false,
      diagnostic: "Selected permission rule set is unavailable.",
    }
  );
}

export function permissionRuleSetDisplayName(id: string): string {
  return (
    BUILT_IN_PERMISSION_RULE_SET_SUMMARIES.find((summary) => summary.id === id)
      ?.name ?? id
  );
}
