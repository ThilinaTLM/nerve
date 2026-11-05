export type FileTreeKeyAction =
  | { type: "extend"; direction: 1 | -1 }
  | { type: "rename" }
  | { type: "delete" }
  | { type: "clear-selection" }
  | { type: "clipboard"; mode: "cut" | "copy" }
  | { type: "paste" }
  | { type: "duplicate" }
  | { type: "select-all" };

/** Maps a files-tree keydown to the action it requests, if any. */
export function fileTreeKeyAction(
  event: Pick<
    KeyboardEvent,
    "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey"
  >,
  hasSelection: boolean,
): FileTreeKeyAction | undefined {
  const modifier = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (event.shiftKey && !modifier && (key === "arrowdown" || key === "arrowup"))
    return { type: "extend", direction: key === "arrowdown" ? 1 : -1 };
  if (!modifier && !event.shiftKey && !event.altKey) {
    if (event.key === "F2") return { type: "rename" };
    if (event.key === "Delete") return { type: "delete" };
    if (event.key === "Escape" && hasSelection)
      return { type: "clear-selection" };
  }
  if (modifier && !event.altKey && !event.shiftKey) {
    if (key === "backspace") return { type: "delete" };
    if (key === "c" || key === "x")
      return { type: "clipboard", mode: key === "c" ? "copy" : "cut" };
    if (key === "v") return { type: "paste" };
    if (key === "d") return { type: "duplicate" };
    if (key === "a") return { type: "select-all" };
  }
  return undefined;
}
