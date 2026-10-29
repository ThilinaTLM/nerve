import { filterCommandItems } from "@nervekit/ui-kit/collections/command-filter";
import type { ModelSelection } from "@nervekit/contracts/models";
import { modelKey, providerDisplayName } from "$lib/presentation/utils/model";
import {
  modelHasCapability,
  type ModelCatalogEntry,
} from "$lib/presentation/utils/model-catalog";

export type ResolvedPickerValue =
  | { kind: "none" }
  | { kind: "available"; entry: ModelCatalogEntry }
  | { kind: "unavailable"; selection: ModelSelection };

/** Key of the row that defers to the parent agent's model. */
export const INHERIT_PICKER_KEY = "inherit";

export type PickerListItem =
  | { kind: "header"; key: string; label: string }
  | { kind: "inherit"; key: typeof INHERIT_PICKER_KEY }
  | { kind: "unavailable"; key: string; selection: ModelSelection }
  | { kind: "model"; key: string; entry: ModelCatalogEntry };

/** A catalog entry as a command-list row: grouped by provider, searchable by
 * name, id, label, provider and capability words ("vision", "reasoning",
 * "long context"). Shared by the picker and the scope editor. */
export function modelCommandItem(entry: ModelCatalogEntry) {
  return {
    key: entry.key,
    label: entry.displayName,
    group: entry.providerLabel,
    keywords: [
      entry.model.modelId,
      entry.model.label,
      entry.model.provider,
      ...(modelHasCapability(entry.model, "vision") ? ["vision", "image"] : []),
      ...(modelHasCapability(entry.model, "reasoning")
        ? ["reasoning", "thinking"]
        : []),
      ...(modelHasCapability(entry.model, "long-context")
        ? ["long context", "long-context"]
        : []),
    ],
    entry,
  };
}

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

/** Rows of the single-model popover: the optional "use the parent's model"
 * row while not searching, a pinned unavailable selection, then the filtered
 * catalog. */
export function pickerListItems(options: {
  query: string;
  entries: ModelCatalogEntry[];
  resolved: ResolvedPickerValue;
  offerInherit?: boolean;
}): PickerListItem[] {
  const items: PickerListItem[] = [];
  if (options.offerInherit && !options.query.trim())
    items.push({ kind: "inherit", key: INHERIT_PICKER_KEY });
  if (options.resolved.kind === "unavailable") {
    items.push({
      kind: "unavailable",
      key: modelKey(options.resolved.selection),
      selection: options.resolved.selection,
    });
  }
  const commands = options.entries.map(modelCommandItem);
  for (const { group, items: matches } of filterCommandItems(
    commands,
    options.query,
  )) {
    items.push({ kind: "header", key: `header:${group}`, label: group });
    for (const { entry } of matches) {
      items.push({ kind: "model", key: entry.key, entry });
    }
  }
  return items;
}

/** Headers are presentation-only and never enter the keyboard option sequence. */
export function pickerNavigableItems(items: PickerListItem[]) {
  return items.filter((item) => item.kind !== "header");
}

export type ScopedCatalogView = "scoped" | "all";

export type ScopedCatalogRow = {
  kind: "model";
  key: string;
  selection: ModelSelection;
  entry?: ModelCatalogEntry;
  checked: boolean;
  stale: boolean;
};

/** A provider section of the scope editor; `selections` are its shown rows
 * and `checked` how many of them are in scope. */
export type ScopedCatalogHeader = {
  kind: "header";
  key: string;
  label: string;
  /** Provider id for the mark; undefined for the unavailable section. */
  provider?: string;
  selections: ModelSelection[];
  checked: number;
};

export type ScopedCatalogItem = ScopedCatalogHeader | ScopedCatalogRow;

const UNAVAILABLE_GROUP = "Unavailable";

/** Rows of the inline scope editor, grouped under provider headers with the
 * same search as the picker. The scoped view lists stale selections (no
 * longer available) first so they stay visible until unchecked. */
export function scopedCatalogRows(options: {
  entries: ModelCatalogEntry[];
  scoped: ModelSelection[];
  view: ScopedCatalogView;
  query: string;
}): ScopedCatalogItem[] {
  const scopedKeys = new Set(options.scoped.map(modelKey));
  const availableKeys = new Set(options.entries.map((entry) => entry.key));
  const stale =
    options.view === "scoped"
      ? options.scoped
          .filter((selection) => !availableKeys.has(modelKey(selection)))
          .map((selection) => ({
            key: modelKey(selection),
            label: selection.modelId,
            group: UNAVAILABLE_GROUP,
            keywords: [
              selection.provider,
              providerDisplayName(selection.provider),
            ],
            row: {
              kind: "model" as const,
              key: modelKey(selection),
              selection,
              checked: true,
              stale: true,
            },
          }))
      : [];
  const live = options.entries
    .filter((entry) => options.view === "all" || scopedKeys.has(entry.key))
    .map((entry) => ({
      ...modelCommandItem(entry),
      row: {
        kind: "model" as const,
        key: entry.key,
        selection: {
          provider: entry.model.provider,
          modelId: entry.model.modelId,
        },
        entry,
        checked: scopedKeys.has(entry.key),
        stale: false,
      },
    }));
  const items: ScopedCatalogItem[] = [];
  for (const { group, items: matches } of filterCommandItems(
    [...stale, ...live],
    options.query,
  )) {
    const rows = matches.map((match) => match.row);
    items.push({
      kind: "header",
      key: `header:${group}`,
      label: group,
      provider:
        group === UNAVAILABLE_GROUP ? undefined : rows[0]?.selection.provider,
      selections: rows.map((row) => row.selection),
      checked: rows.filter((row) => row.checked).length,
    });
    items.push(...rows);
  }
  return items;
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
