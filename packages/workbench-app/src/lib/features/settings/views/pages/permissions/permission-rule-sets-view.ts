import {
  permissionOverlayForOriginSchema,
  permissionRuleSchema,
  type PermissionOverlayOrigin,
  type PermissionPolicyConfiguration,
  type PermissionRule,
  type PermissionRuleSetSummary,
} from "@nervekit/contracts/permissions";

/** Baseline is the foundation applied under every agent, so it can't be chosen as the default. */
export const nonSelectableRuleSetIds = ["baseline"] as const;

export function isDefaultEligible(ruleSet: PermissionRuleSetSummary): boolean {
  if (nonSelectableRuleSetIds.includes(ruleSet.id as "baseline")) return false;
  return ruleSet.enabled && ruleSet.available;
}

export type OverrideScope = "user" | "project";

export function overridesFor(
  configuration: PermissionPolicyConfiguration,
  scope: OverrideScope,
  ruleSetId: string,
): PermissionRule[] {
  const document =
    scope === "user"
      ? configuration.userOverlays
      : configuration.projectOverlays;
  return (
    document.overlays.find((overlay) => overlay.ruleSetId === ruleSetId)
      ?.rules ?? []
  );
}

function plural(count: number, noun: string): string {
  return `${count} ${noun} ${count === 1 ? "override" : "overrides"}`;
}

/** The always-visible second line of a rule set row. */
export function overlaySummary(
  configuration: PermissionPolicyConfiguration,
  ruleSetId: string,
): { user: number; project: number; label: string } {
  const user = overridesFor(configuration, "user", ruleSetId).length;
  const project = overridesFor(configuration, "project", ruleSetId).length;
  const parts: string[] = [];
  if (user > 0) parts.push(plural(user, "user"));
  if (project > 0) {
    const applied = configuration.projectTrust.status === "trusted";
    parts.push(
      `${plural(project, "project")}${applied ? "" : " (not applied)"}`,
    );
  }
  return {
    user,
    project,
    label: parts.length > 0 ? parts.join(" · ") : "No overrides",
  };
}

export const decisionLabels = {
  allow: "Allow",
  prompt: "Ask",
  deny: "Block",
} as const;

/** Second-line facts for one override row: tools, condition count, decision. */
export function ruleMetadata(rule: PermissionRule): string[] {
  const conditions = Object.keys(rule.when).length;
  return [
    rule.when.toolNames?.join(", ") ?? "Any tool",
    conditions === 1 ? "1 condition" : `${conditions} conditions`,
    decisionLabels[rule.decision],
  ];
}

export function ruleTitle(rule: PermissionRule): string {
  return rule.description ?? rule.id;
}

/** Starting JSON for a new rule, with an unused ID and priority for this overlay. */
export function newRuleTemplate(siblings: readonly PermissionRule[]): string {
  let n = 1;
  while (siblings.some((rule) => rule.id === `new-rule-${n}`)) n++;
  let priority = 0;
  while (
    siblings.some(
      (rule) =>
        rule.enforcement === "overridable" && rule.priority === priority,
    )
  )
    priority++;
  const template: PermissionRule = {
    id: `new-rule-${n}`,
    description: "Describe this override",
    enabled: true,
    priority,
    enforcement: "overridable",
    when: {
      toolNames: ["bash"],
      primaryArgument: { operator: "equals", value: "your exact command" },
    },
    decision: "prompt",
  };
  return JSON.stringify(template, null, 2);
}

export type RuleValidation =
  | { rule: PermissionRule; error?: undefined }
  | { rule?: undefined; error: string };

/**
 * Validates one rule's JSON against the rule schema and, together with the
 * other rules in the same overlay, the scope's overlay restrictions.
 */
export function validateRuleSource(
  source: string,
  origin: Exclude<PermissionOverlayOrigin, "conversation">,
  ruleSetId: string,
  siblings: readonly PermissionRule[],
): RuleValidation {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return { error: "Invalid JSON. Check quotes, commas and brackets." };
  }
  const parsed = permissionRuleSchema.safeParse(value);
  if (!parsed.success)
    return {
      error: parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "rule"}: ${issue.message}`)
        .join("\n"),
    };
  const overlay = permissionOverlayForOriginSchema(origin).safeParse({
    ruleSetId,
    rules: [...siblings, parsed.data],
  });
  if (!overlay.success)
    return {
      error: overlay.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("\n"),
    };
  return { rule: parsed.data };
}
