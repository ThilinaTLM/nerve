import type {
  AutoCompactionSettings,
  CompactionProfile,
} from "@nervekit/contracts";
import type { AgentMessage } from "../../types.js";
import type { FileOperations } from "./utils.js";

/** File-operation details stored on generated compaction entries. */
export interface CompactionDetails {
  /** Files read in the compacted history. */
  readFiles: string[];
  /** Files modified in the compacted history. */
  modifiedFiles: string[];
}

/** Generated compaction data ready to be persisted as a compaction entry. */
export interface CompactionResult<T = unknown> {
  /** Summary text that replaces compacted history in future context. */
  summary: string;
  /** Entry id where retained history starts. */
  firstKeptEntryId: string;
  /** Estimated context tokens before compaction. */
  tokensBefore: number;
  /** Optional implementation-specific details stored with the compaction entry. */
  details?: T;
}

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

/** Estimated context-token usage for a message list. */
export interface ContextUsageEstimate {
  /** Estimated total context tokens. */
  tokens: number;
  /** Tokens reported by the most recent assistant usage block. */
  usageTokens: number;
  /** Estimated tokens after the most recent assistant usage block. */
  trailingTokens: number;
  /** Index of the message that provided usage, or null when none exists. */
  lastUsageIndex: number | null;
}

/** Cut point selected for compaction. */
export interface CutPointResult {
  /** Index of the first entry retained after compaction. */
  firstKeptEntryIndex: number;
  /** Index of the turn-start entry when the cut splits a turn, otherwise -1. */
  turnStartIndex: number;
  /** Whether the selected cut point splits an in-progress turn. */
  isSplitTurn: boolean;
}

/** Prepared inputs for a compaction run. */
export interface CompactionPreparation {
  /** Entry id where retained history starts. */
  firstKeptEntryId: string;
  /** Messages summarized into the history summary. */
  messagesToSummarize: AgentMessage[];
  /** Prefix messages summarized separately when compaction splits a turn. */
  turnPrefixMessages: AgentMessage[];
  /** Whether compaction splits a turn. */
  isSplitTurn: boolean;
  /** Estimated context tokens before compaction. */
  tokensBefore: number;
  /** Previous compaction summary used for iterative updates. */
  previousSummary?: string;
  /** File operations extracted from summarized history. */
  fileOps: FileOperations;
  /** Settings used to prepare compaction. */
  settings: CompactionSettings;
}
