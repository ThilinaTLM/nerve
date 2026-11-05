import type { PermissionRuleSetSummary } from "@nervekit/contracts/permissions";
import type { ProfileOption } from "$lib/application/agent-profiles/agent-profile-catalog.svelte";

/** Sub-agents run read-only or autonomous; nothing in between. */
const SUBAGENT_RULE_SETS = new Set(["read_only", "autonomous"]);

/** Profiles the selector offers; a viewed sub-agent shows only its own, read-only. */
export function composerProfiles(input: {
  viewingChild: boolean;
  selectedProfile: string;
  resolvedProfiles: readonly ProfileOption[];
  leadProfiles: readonly ProfileOption[];
}) {
  if (input.viewingChild)
    return [
      {
        name: input.selectedProfile,
        label: input.selectedProfile,
        source: input.resolvedProfiles.find(
          (profile) => profile.name === input.selectedProfile,
        )?.source,
      },
    ];
  return input.leadProfiles.map((profile) => ({
    name: profile.name,
    label: profile.label,
    whenToUse: profile.whenToUse,
    source: profile.source,
  }));
}

/** Rule sets a sub-agent may use when one is viewed; all selectable otherwise. */
export function permissionRuleSetsFor(
  selectable: readonly PermissionRuleSetSummary[],
  viewingChild: boolean,
): PermissionRuleSetSummary[] {
  return selectable.filter(
    (rules) => !viewingChild || SUBAGENT_RULE_SETS.has(rules.id),
  );
}
