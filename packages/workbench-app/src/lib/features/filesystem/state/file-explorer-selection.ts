export type FileExplorerSelection = {
  /** Selected node ids. */
  ids: ReadonlySet<string>;
  /** Fixed end of a Shift range. */
  anchorId?: string;
};

export const emptyFileExplorerSelection: FileExplorerSelection = {
  ids: new Set(),
};

export function selectOnly(id: string): FileExplorerSelection {
  return { ids: new Set([id]), anchorId: id };
}

export function toggleSelected(
  selection: FileExplorerSelection,
  id: string,
): FileExplorerSelection {
  const ids = new Set(selection.ids);
  if (!ids.delete(id)) ids.add(id);
  return { ids, anchorId: id };
}

/** Selects the visible rows between the anchor (or `id` itself) and `id`. */
export function selectRange(
  visibleIds: readonly string[],
  selection: FileExplorerSelection,
  id: string,
): FileExplorerSelection {
  const anchorId =
    selection.anchorId && visibleIds.includes(selection.anchorId)
      ? selection.anchorId
      : id;
  const from = visibleIds.indexOf(anchorId);
  const to = visibleIds.indexOf(id);
  if (from < 0 || to < 0) return selectOnly(id);
  const [start, end] = from <= to ? [from, to] : [to, from];
  return { ids: new Set(visibleIds.slice(start, end + 1)), anchorId };
}

/** Keeps only ids that still exist (after refresh, filtering or collapse). */
export function pruneSelection(
  selection: FileExplorerSelection,
  existing: ReadonlySet<string>,
): FileExplorerSelection {
  let changed = false;
  const ids = new Set<string>();
  for (const id of selection.ids) {
    if (existing.has(id)) ids.add(id);
    else changed = true;
  }
  return changed ? { ids, anchorId: selection.anchorId } : selection;
}
