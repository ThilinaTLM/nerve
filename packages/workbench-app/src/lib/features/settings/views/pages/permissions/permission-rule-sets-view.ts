import type {
  PermissionPolicyConfiguration,
  PermissionRuleSetSummary,
} from "@nervekit/contracts/permissions";

/**
 * Baseline is the foundation applied under every coding agent and Planning is forced
 * while planning mode is active, so neither can be chosen as the coding default.
 */
export const nonSelectableRuleSetIds = ["baseline", "planning"] as const;

export function isDefaultEligible(ruleSet: PermissionRuleSetSummary): boolean {
  if (nonSelectableRuleSetIds.includes(ruleSet.id as "baseline" | "planning")) {
    return false;
  }
  if (!ruleSet.enabled || !ruleSet.available) return false;
  return (
    ruleSet.compatibleModes === undefined ||
    ruleSet.compatibleModes.includes("coding")
  );
}

/** Short label describing when a rule set applies. */
export function ruleSetRole(ruleSet: PermissionRuleSetSummary): string {
  if (ruleSet.id === "baseline") return "Always applied";
  if (ruleSet.id === "planning") return "Planning mode";
  return "Coding";
}

export type OverlaySummary = {
  project: number;
  user: number;
  label: string;
};

function countRules(
  overlays: PermissionPolicyConfiguration["userOverlays"],
  ruleSetId: string,
): number {
  return (
    overlays.overlays.find((overlay) => overlay.ruleSetId === ruleSetId)?.rules
      .length ?? 0
  );
}

/** Per-rule-set override counts, so the page can summarise instead of listing rules. */
export function overlaySummary(
  configuration: PermissionPolicyConfiguration,
  ruleSetId: string,
): OverlaySummary {
  const project = countRules(configuration.projectOverlays, ruleSetId);
  const user = countRules(configuration.userOverlays, ruleSetId);
  const parts: string[] = [];
  if (project > 0) parts.push(`Project ${project}`);
  if (user > 0) parts.push(`User ${user}`);
  return {
    project,
    user,
    label: parts.length > 0 ? parts.join(" · ") : "No overrides",
  };
}
