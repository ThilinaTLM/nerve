import type { CompactionPlan } from "./cut-points.js";
import type { AgentMessage } from "../agent/contracts/index.js";
import type { FileOperations } from "./file-operations.js";
import type { CompactionSettings } from "./compaction-policy.js";

/** Cut point selected for compaction. */
export interface CutPointResult {
  retainedTokens: number;
  retainedMessages: number;
  retentionBudgetExceeded: boolean;
  /** Index of the first entry retained after compaction. */
  firstKeptEntryIndex: number;
  /** Index of the turn-start entry when the cut splits a turn, otherwise -1. */
  turnStartIndex: number;
  /** Whether the selected cut point splits an in-progress turn. */
  isSplitTurn: boolean;
}

/** Prepared inputs for a compaction run. */
export interface CompactionPreparation {
  /** Pure planning/accounting data; persist anchors and known proposal lineage with the checkpoint. */
  plan?: CompactionPlan;
  /** Entry id where retained history starts. */
  firstKeptEntryId: string;
  /** Messages summarized into the history summary. */
  messagesToSummarize: AgentMessage[];
  /** Prefix messages included in the checkpoint when compaction splits a turn. */
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
