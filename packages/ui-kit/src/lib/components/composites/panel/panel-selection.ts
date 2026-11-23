/** Multi-selection over row ids, with the fixed end of a Shift range. */
export type PanelSelection = {
  /** Selected node ids. */
  ids: ReadonlySet<string>;
  /** Fixed end of a Shift range. */
  anchorId?: string;
};

export const emptyPanelSelection: PanelSelection = {
  ids: new Set(),
};

export function selectOnly(id: string): PanelSelection {
  return { ids: new Set([id]), anchorId: id };
}

export function toggleSelected(
  selection: PanelSelection,
  id: string,
): PanelSelection {
  const ids = new Set(selection.ids);
  if (!ids.delete(id)) ids.add(id);
  return { ids, anchorId: id };
}

/** Selects the visible rows between the anchor (or `id` itself) and `id`. */
export function selectRange(
  visibleIds: readonly string[],
  selection: PanelSelection,
  id: string,
): PanelSelection {
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
  selection: PanelSelection,
  existing: ReadonlySet<string>,
): PanelSelection {
  let changed = false;
  const ids = new Set<string>();
  for (const id of selection.ids) {
    if (existing.has(id)) ids.add(id);
    else changed = true;
  }
  return changed ? { ids, anchorId: selection.anchorId } : selection;
}

export function selectAll(visibleIds: readonly string[]): PanelSelection {
  return { ids: new Set(visibleIds), anchorId: visibleIds[0] };
}

type ClickModifiers = Pick<MouseEvent, "shiftKey" | "ctrlKey" | "metaKey">;

/**
 * Applies a row click: Shift selects the visible range, Ctrl/Cmd toggles, and a
 * plain click selects only the row. `consumed` is true for the modifier
 * gestures, which must not also activate the row.
 */
export function clickSelection(
  selection: PanelSelection,
  visibleIds: readonly string[],
  id: string,
  event: ClickModifiers,
): { selection: PanelSelection; consumed: boolean } {
  if (event.shiftKey)
    return {
      selection: selectRange(visibleIds, selection, id),
      consumed: true,
    };
  if (event.metaKey || event.ctrlKey)
    return { selection: toggleSelected(selection, id), consumed: true };
  return { selection: selectOnly(id), consumed: false };
}

export type PanelSelectionKeyAction =
  | { type: "extend"; direction: 1 | -1 }
  | { type: "clear-selection" }
  | { type: "select-all" };

/** Shift+Arrow extends, Ctrl/Cmd+A selects all, Escape clears a selection. */
export function panelSelectionKeyAction(
  event: Pick<
    KeyboardEvent,
    "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey"
  >,
  hasSelection: boolean,
): PanelSelectionKeyAction | undefined {
  const modifier = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (event.shiftKey && !modifier && (key === "arrowdown" || key === "arrowup"))
    return { type: "extend", direction: key === "arrowdown" ? 1 : -1 };
  if (!modifier && !event.shiftKey && !event.altKey) {
    if (event.key === "Escape" && hasSelection)
      return { type: "clear-selection" };
  }
  if (modifier && !event.altKey && !event.shiftKey && key === "a")
    return { type: "select-all" };
  return undefined;
}

/**
 * Applies a selection key action for the focused row `id`. `revealId` is the
 * row that should receive focus afterwards (the new end of an extension).
 */
export function applySelectionKey(
  selection: PanelSelection,
  visibleIds: readonly string[],
  id: string,
  action: PanelSelectionKeyAction,
): { selection: PanelSelection; revealId?: string } {
  switch (action.type) {
    case "clear-selection":
      return { selection: emptyPanelSelection };
    case "select-all":
      return { selection: selectAll(visibleIds) };
    case "extend": {
      const index = visibleIds.indexOf(id);
      const neighbor = visibleIds[index + action.direction];
      if (index < 0 || neighbor === undefined) return { selection };
      const base = selection.ids.size > 0 ? selection : selectOnly(id);
      return {
        selection: selectRange(visibleIds, base, neighbor),
        revealId: neighbor,
      };
    }
  }
}
