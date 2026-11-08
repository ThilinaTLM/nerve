import type { GitPrFilterConfig, GitPrQuickFilter } from "../pr-filters";
import {
  loadPrPanelPreferences,
  persistPrPanelPreferences,
  type PrPanelPreferences,
} from "./pr-panel-preferences";

/** Values changed this session (reactive). */
const changed = $state<Record<string, PrPanelPreferences>>({});
/** Values read from storage once; not reactive, never written in a derived. */
const loaded: Record<string, PrPanelPreferences> = {};

/** Remembered quick filter and filter menu of one project. */
export function prPanelPreferences(projectId: string): PrPanelPreferences {
  const override = changed[projectId];
  if (override) return override;
  return (loaded[projectId] ??= loadPrPanelPreferences(projectId));
}

function update(projectId: string, patch: Partial<PrPanelPreferences>): void {
  const next = { ...prPanelPreferences(projectId), ...patch };
  changed[projectId] = next;
  persistPrPanelPreferences(projectId, next);
}

export function setPrPanelQuickFilter(
  projectId: string,
  quick: GitPrQuickFilter,
): void {
  update(projectId, { quick });
}

export function setPrPanelFilters(
  projectId: string,
  filters: GitPrFilterConfig,
): void {
  update(projectId, { filters });
}

/** Search text: kept while switching tabs in a session, never persisted. */
export const prPanelSearch = $state({ query: "" });
