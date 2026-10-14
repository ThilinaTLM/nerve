import type { Snippet } from "svelte";

export interface CapabilitySubagentCounts {
  enabled: number;
  total: number;
}

/**
 * What the Capabilities popover hands the sub-agent profiles content it
 * renders: the Delegation master row and the tab count.
 */
export interface CapabilitySubagentSlot {
  /** The Delegation row; absent when this conversation can't change it. */
  readonly delegation?: Snippet;
  /** Delegation is off, so profile rows are shown dimmed. */
  readonly delegationOff: boolean;
  setCounts(counts: CapabilitySubagentCounts | undefined): void;
}

export type CapabilitySubagentProfiles = Snippet<
  [query: string, slot: CapabilitySubagentSlot]
>;
