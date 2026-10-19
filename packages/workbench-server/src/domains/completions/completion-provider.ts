import type {
  CompletionChanged,
  CompletionItem,
  CompletionScope,
  CompletionSourceState,
} from "@nervekit/contracts/completions";
import type { CompletionContext } from "./completion-ranking-policy.js";

import type { SearchDocument, SearchIndex } from "@nervekit/native";
export type { SearchDocument } from "@nervekit/native";
export type CompletionSearchIndex = SearchIndex;
export type CompletionDocument = SearchDocument & {
  projectId: string;
  conversationId?: string;
  item: CompletionItem;
  version: string;
  stateBoost?: number;
  /** Retained string units for compact/lazy provider projections (not RSS). */
  retainedUnits?: number;
  displayField?: { index: number; offset: number };
  displayFields?: { index: number; offset: number }[];
  detailFields?: { index: number; offset: number }[];
  /** Runs only after a fresh owner read plus expectedVersion comparison. */
  setEnabled?: (enabled: boolean) => Promise<void>;
};
export type CompletionProviderSnapshot = {
  documents: readonly CompletionDocument[];
  status: CompletionSourceState["status"];
  refreshing?: boolean;
  reason?: string;
  action?: CompletionSourceState["action"];
  updatedAt?: number;
};
export type CompletionInvalidation = { refreshCause?: "uncertain_poll" };
export type CompletionInvalidate = (
  scope?: Partial<CompletionScope>,
  hint?: CompletionInvalidation,
) => void;
export interface CompletionProvider {
  id: string;
  /** Conversation catalogs are small overlays; project corpora are indexed once. */
  scope?: "project" | "conversation";
  remote?: boolean;
  /** Revoke cached access/trust metadata immediately on owner invalidation. */
  accessSensitive?: boolean;
  ttlMs: number;
  load(
    scope: CompletionScope,
  ): Promise<readonly CompletionDocument[] | CompletionProviderSnapshot>;
  subscribe?(invalidate: CompletionInvalidate): () => void;
}
export type CompletionServiceDependencies = {
  home: string;
  /** Must reject unknown project and conversation/project mismatch. */
  authorize(scope: CompletionScope): void | Promise<void>;
  context(
    scope: CompletionScope,
  ): CompletionContext | Promise<CompletionContext>;
  providers: readonly CompletionProvider[];
  createIndex?: () => Promise<CompletionSearchIndex>;
  changed?: (change: CompletionChanged) => void;
  now?: () => number;
  maxProjects?: number;
  maxContextsPerProject?: number;
};
export type ProviderState = CompletionSourceState & {
  generation: number;
  /** Hard invalidations supersede data; uncertain polls preserve active work. */
  hardGeneration?: number;
  completedGeneration?: number;
  uncertainty?: number;
  expiresAt: number;
  pending?: Promise<void>;
  ids: Set<string>;
  units: number;
  count: number;
};
