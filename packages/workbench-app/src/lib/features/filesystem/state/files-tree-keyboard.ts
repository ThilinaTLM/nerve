import {
  panelSelectionKeyAction,
  type PanelSelectionKeyAction,
} from "@nervekit/ui-kit/components/composites/panel/panel-selection";

export type FileTreeKeyAction =
  | PanelSelectionKeyAction
  | { type: "rename" }
  | { type: "delete" }
  | { type: "clipboard"; mode: "cut" | "copy" }
  | { type: "paste" }
  | { type: "duplicate" };

/** Maps a files-tree keydown to the action it requests, if any. */
export function fileTreeKeyAction(
  event: Pick<
    KeyboardEvent,
    "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey"
  >,
  hasSelection: boolean,
): FileTreeKeyAction | undefined {
  const selectionAction = panelSelectionKeyAction(event, hasSelection);
  if (selectionAction) return selectionAction;
  const modifier = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (!modifier && !event.shiftKey && !event.altKey) {
    if (event.key === "F2") return { type: "rename" };
    if (event.key === "Delete") return { type: "delete" };
  }
  if (modifier && !event.altKey && !event.shiftKey) {
    if (key === "backspace") return { type: "delete" };
    if (key === "c" || key === "x")
      return { type: "clipboard", mode: key === "c" ? "copy" : "cut" };
    if (key === "v") return { type: "paste" };
    if (key === "d") return { type: "duplicate" };
  }
  return undefined;
}
