import {
  agentProfilesState,
  refreshAgentProfiles,
} from "../../state/agent-profiles.svelte";

export type ProfileOption = { name: string; label: string };

/**
 * Loads the profile catalog for a settings target and lists the profiles a
 * main agent can use (`lead` or `both`), for pickers such as the start profile
 * and the plan-approval target. Call from a component's `$effect` root.
 */
export function ensureProfilesFor(
  scope: "user" | "project",
  projectId: string | undefined,
): void {
  const here =
    agentProfilesState.loaded &&
    agentProfilesState.scope === scope &&
    agentProfilesState.projectId === projectId;
  if (!here && !agentProfilesState.loading)
    void refreshAgentProfiles(projectId, scope);
}

export function leadProfileOptions(): ProfileOption[] {
  return (agentProfilesState.configuration?.profiles ?? []).flatMap(
    (profile) => {
      const effective = profile.effective;
      return effective &&
        effective.enabled &&
        effective.usableBy !== "subagent" &&
        !profile.diagnostics.some((item) => item.severity === "blocking")
        ? [{ name: profile.name, label: effective.label }]
        : [];
    },
  );
}

export function profileLabelFor(name: string): string {
  return (
    agentProfilesState.configuration?.profiles.find(
      (profile) => profile.name === name,
    )?.effective?.label ?? name
  );
}
