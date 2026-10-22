/** An agent profile the lead can delegate to, as the Capabilities popover lists it. */
export type CapabilitySubagentProfile = {
  name: string;
  label: string;
  description?: string;
  /** Turned off in Settings. */
  disabled?: boolean;
  /** Blocked profile: why it is never offered to the model. */
  error?: string;
};

/** Profiles delegation can actually use right now. */
export function capabilitySubagentCounts(
  profiles: readonly CapabilitySubagentProfile[],
): { available: number; total: number } {
  return {
    available: profiles.filter((profile) => !profile.disabled && !profile.error)
      .length,
    total: profiles.length,
  };
}
