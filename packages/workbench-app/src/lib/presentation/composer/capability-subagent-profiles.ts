import type { LeadSettingsOverrides } from "@nervekit/contracts/agent-configuration";

/** An agent profile the lead can delegate to, as the Capabilities popover lists it. */
export type CapabilitySubagentProfile = {
  name: string;
  label: string;
  description?: string;
  /** Authored launch default, below scoped preferences. */
  defaultEnabled?: boolean;
  /** Blocked profile: why it is never offered to the model. */
  error?: string;
};

export function capabilitySubagentEnabled(
  profile: CapabilitySubagentProfile,
  subagents: LeadSettingsOverrides["subagents"],
): boolean {
  return subagents?.[profile.name]?.enabled ?? profile.defaultEnabled ?? true;
}

/** Available profiles enabled by the effective launch settings. */
export function capabilitySubagentCounts(
  profiles: readonly CapabilitySubagentProfile[],
  subagents?: LeadSettingsOverrides["subagents"],
): { available: number; total: number } {
  return {
    available: profiles.filter(
      (profile) =>
        !profile.error && capabilitySubagentEnabled(profile, subagents),
    ).length,
    total: profiles.length,
  };
}
