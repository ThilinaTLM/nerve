import type { ModelSelection } from "$lib/api";
import { modelKey } from "$lib/presentation/utils/model";
import {
  filterModelCatalog,
  type ModelCapability,
  type ModelCatalogEntry,
} from "$lib/presentation/utils/model-catalog";

export type ResolvedPickerValue =
  | { kind: "none" }
  | { kind: "available"; entry: ModelCatalogEntry }
  | { kind: "unavailable"; selection: ModelSelection };

export type PickerListItem =
  | { kind: "unavailable"; key: string; selection: ModelSelection }
  | { kind: "model"; key: string; entry: ModelCatalogEntry };

type CatalogFilter = {
  query: string;
  provider: string;
  capabilities: ReadonlySet<ModelCapability>;
};

/** Classifies the stored value against the models the picker can offer. */
export function resolvePickerValue(
  entries: ModelCatalogEntry[],
  value: ModelSelection | undefined,
): ResolvedPickerValue {
  if (!value) return { kind: "none" };
  const key = modelKey(value);
  const entry = entries.find((candidate) => candidate.key === key);
  return entry
    ? { kind: "available", entry }
    : { kind: "unavailable", selection: value };
}

/** Rows of the single-model popover: a pinned unavailable selection, then
 * the filtered catalog. */
export function pickerListItems(
  options: CatalogFilter & {
    entries: ModelCatalogEntry[];
    resolved: ResolvedPickerValue;
  },
): PickerListItem[] {
  const items: PickerListItem[] = [];
  if (options.resolved.kind === "unavailable") {
    items.push({
      kind: "unavailable",
      key: modelKey(options.resolved.selection),
      selection: options.resolved.selection,
    });
  }
  for (const entry of filterModelCatalog(
    options.entries,
    options.query,
    options.provider,
    options.capabilities,
  )) {
    items.push({ kind: "model", key: entry.key, entry });
  }
  return items;
}

export type ScopedCatalogView = "scoped" | "all";

export type ScopedCatalogRow = {
  key: string;
  selection: ModelSelection;
  entry?: ModelCatalogEntry;
  checked: boolean;
  stale: boolean;
};

/** Rows of the inline scope editor. The scoped view keeps stale selections
 * (no longer available) first so they stay visible until unchecked. */
export function scopedCatalogRows(
  options: CatalogFilter & {
    entries: ModelCatalogEntry[];
    scoped: ModelSelection[];
    view: ScopedCatalogView;
  },
): ScopedCatalogRow[] {
  const scopedKeys = new Set(options.scoped.map(modelKey));
  const filtered = filterModelCatalog(
    options.entries,
    options.query,
    options.provider,
    options.capabilities,
  );
  const toRow = (entry: ModelCatalogEntry): ScopedCatalogRow => ({
    key: entry.key,
    selection: { provider: entry.model.provider, modelId: entry.model.modelId },
    entry,
    checked: scopedKeys.has(entry.key),
    stale: false,
  });
  if (options.view === "all") return filtered.map(toRow);

  const availableKeys = new Set(options.entries.map((entry) => entry.key));
  const needle = options.query.trim().toLowerCase();
  const stale = options.scoped
    .filter((selection) => !availableKeys.has(modelKey(selection)))
    .filter(
      (selection) =>
        options.capabilities.size === 0 &&
        (options.provider === "all" ||
          selection.provider === options.provider) &&
        (!needle ||
          `${selection.provider}/${selection.modelId}`
            .toLowerCase()
            .includes(needle)),
    )
    .map((selection) => ({
      key: modelKey(selection),
      selection,
      checked: true,
      stale: true,
    }));
  return [
    ...stale,
    ...filtered.filter((entry) => scopedKeys.has(entry.key)).map(toRow),
  ];
}

/** Returns the next scope, preserving order and stale selections. */
export function toggleScopedModel(
  scoped: ModelSelection[],
  selection: ModelSelection,
  checked: boolean,
): ModelSelection[] {
  const key = modelKey(selection);
  const present = scoped.some((candidate) => modelKey(candidate) === key);
  if (checked) {
    return present
      ? scoped
      : [
          ...scoped,
          { provider: selection.provider, modelId: selection.modelId },
        ];
  }
  return present
    ? scoped.filter((candidate) => modelKey(candidate) !== key)
    : scoped;
}
