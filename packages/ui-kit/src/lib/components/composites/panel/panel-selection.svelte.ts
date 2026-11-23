import {
  applySelectionKey,
  clickSelection,
  emptyPanelSelection,
  panelSelectionKeyAction,
  pruneSelection,
  selectOnly,
  type PanelSelection,
} from "./panel-selection.js";

/**
 * Reactive multi-selection for a `PanelTree` (pass it as `selection`). Click,
 * Ctrl/Cmd-click, Shift-click, Shift+Arrow, Ctrl/Cmd+A and Escape are handled
 * by the tree; ids are tree node ids (`panelItemNodeId(key)` for item rows).
 */
export class PanelSelectionState {
  selection = $state.raw<PanelSelection>(emptyPanelSelection);

  get ids(): ReadonlySet<string> {
    return this.selection.ids;
  }

  get size(): number {
    return this.selection.ids.size;
  }

  has(id: string): boolean {
    return this.selection.ids.has(id);
  }

  selectOnly(id: string): void {
    this.selection = selectOnly(id);
  }

  clear(): void {
    if (this.selection.ids.size > 0) this.selection = emptyPanelSelection;
  }

  /** Drops ids whose rows no longer exist. */
  prune(existing: ReadonlySet<string>): void {
    this.selection = pruneSelection(this.selection, existing);
  }

  /** Returns true when the click was a selection gesture and must not activate the row. */
  handleClick(
    event: Pick<MouseEvent, "shiftKey" | "ctrlKey" | "metaKey">,
    id: string,
    visibleIds: readonly string[],
  ): boolean {
    const result = clickSelection(this.selection, visibleIds, id, event);
    this.selection = result.selection;
    return result.consumed;
  }

  /** Returns the handled state and the row to focus next, if any. */
  handleKey(
    event: KeyboardEvent,
    id: string,
    visibleIds: readonly string[],
  ): { handled: boolean; revealId?: string } {
    const action = panelSelectionKeyAction(event, this.size > 0);
    if (!action) return { handled: false };
    const result = applySelectionKey(this.selection, visibleIds, id, action);
    this.selection = result.selection;
    return { handled: true, revealId: result.revealId };
  }
}
