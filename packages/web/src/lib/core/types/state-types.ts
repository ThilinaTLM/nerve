// Aggregated workbench state types. This is a type-only barrel: each feature
// owns and re-exports its own state types; this module simply collects them in
// one neutral place for cross-feature consumers.
export type {
  CompactionNotice,
  ConversationLiveState,
  ConversationViewState,
  LiveToolCallDraft,
  LiveToolOutput,
  PendingConversationState,
  RunStatusNotice,
  TaskEventNotice,
  TranscriptItem,
} from "$lib/features/conversations";
export type { FileViewState } from "$lib/features/filesystem";
export type { GitContext, PrViewState } from "$lib/features/git";
export type { CenterTabIdentity } from "$lib/features/workspace";
