import type { DockId } from "./shell-types.js";

/** Mime type carried by an in-flight panel view drag. */
export const PANEL_VIEW_MIME = "application/x-nerve-panel-view";

/**
 * Module-scoped state for the in-flight panel view drag. HTML5 drag data is not
 * readable during `dragover`, so the shell mirrors it here to drive hover
 * affordances across docks.
 */
export const shellDrag = $state<{
  viewId?: string;
  hoverDock?: DockId;
  hoverIndex?: number;
}>({});

export function beginPanelViewDrag(viewId: string): void {
  shellDrag.viewId = viewId;
  shellDrag.hoverDock = undefined;
  shellDrag.hoverIndex = undefined;
}

export function setPanelViewDropTarget(dock: DockId, index: number): void {
  shellDrag.hoverDock = dock;
  shellDrag.hoverIndex = index;
}

export function clearPanelViewDropTarget(dock: DockId): void {
  if (shellDrag.hoverDock !== dock) return;
  shellDrag.hoverDock = undefined;
  shellDrag.hoverIndex = undefined;
}

export function endPanelViewDrag(): void {
  shellDrag.viewId = undefined;
  shellDrag.hoverDock = undefined;
  shellDrag.hoverIndex = undefined;
}
