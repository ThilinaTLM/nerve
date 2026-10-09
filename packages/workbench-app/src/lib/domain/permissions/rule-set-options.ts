import type { Mode } from "@nervekit/contracts/settings";
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
      name: "Read only",
      description:
        "Allow interaction, local inspection, and Explore; deny all other capabilities.",
      source: "builtin",
      enabled: true,
      compatibleModes: ["coding"],
      available: true,
    },
    {
      id: "supervised",
      name: "Supervised",
      description:
        "Allow interaction and local inspection; prompt for other capabilities.",
      source: "builtin",
      enabled: true,
      compatibleModes: ["coding"],
      available: true,
    },
    {
      id: "autonomous",
      name: "Autonomous",
      description: "Allow every valid tool request.",
      source: "builtin",
      enabled: true,
      compatibleModes: ["coding"],
      available: true,
    },
    {
      id: "planning",
      name: "Planning",
      description:
        "Allow reads, interaction, Explore, and writes wholly within the plans directory.",
      source: "builtin",
      enabled: true,
      compatibleModes: ["planning"],
      available: true,
    },
  ];

export function selectablePermissionRuleSets(
  summaries: readonly PermissionRuleSetSummary[],
  mode: Mode,
): PermissionRuleSetSummary[] {
  if (mode === "planning") {
    const planning = summaries.find(
      (summary) =>
        summary.id === "planning" && summary.available && summary.enabled,
    );
    return planning
      ? [planning]
      : [
          BUILT_IN_PERMISSION_RULE_SET_SUMMARIES.find(
            (summary) => summary.id === "planning",
          )!,
        ];
  }

  return summaries.filter(
    (summary) =>
      summary.id !== "baseline" &&
      summary.id !== "planning" &&
      summary.available &&
      summary.enabled &&
      (summary.compatibleModes === undefined ||
        summary.compatibleModes.includes("coding")),
  );
}

export function effectivePermissionRuleSetId(
  selectedCodingRuleSetId: PermissionRuleSetId,
  mode: Mode,
): PermissionRuleSetId {
  return mode === "planning" ? "planning" : selectedCodingRuleSetId;
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
