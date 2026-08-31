import type {
  AutoCompactionSettings,
  CompactionProfile,
} from "@nervekit/contracts/settings";

/** Compaction thresholds and retention settings. */
export interface CompactionSettings {
  /** Enable automatic compaction decisions. */
  enabled: boolean;
  /** Tokens reserved for summary prompt and output. */
  reserveTokens: number;
  /** Approximate recent-context tokens to keep after compaction. */
  keepRecentTokens: number;
}

export type AutoCompactionReason = "threshold" | "overflow" | "manual";

export interface AutoCompactionPolicy {
  enabled: boolean;
  profile: CompactionProfile;
  contextWindow: number;
  thresholdPercent: number;
  keepRecentPercent: number;
  thresholdTokens: number;
  triggerReserveTokens: number;
  keepRecentTokens: number;
  summaryReserveTokens: number;
  safetyHeadroomTokens: number;
}

export type AutoCompactionConfiguration = AutoCompactionSettings;
