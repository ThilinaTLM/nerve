export type Box = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type ToolbarPlacement = {
  /** Offset from the container's left edge to the toolbar's center. */
  x: number;
  /** Offset from the container's top edge to the toolbar's top. */
  y: number;
  side: "above" | "below";
};

const GAP = 6;
const EDGE = 8;

/**
 * Place the selection toolbar centered above the selection, flipping below
 * when there is no room and clamping it inside the container.
 */
export function placeSelectionToolbar(
  selection: Box,
  container: Box,
  toolbar: { width: number; height: number },
): ToolbarPlacement {
  const half = toolbar.width / 2;
  const width = container.right - container.left;
  const center = (selection.left + selection.right) / 2 - container.left;
  const x =
    width < toolbar.width + EDGE * 2
      ? width / 2
      : Math.min(Math.max(center, half + EDGE), width - half - EDGE);

  const above = selection.top - container.top - GAP - toolbar.height;
  if (above >= EDGE) return { x, y: above, side: "above" };
  const below = selection.bottom - container.top + GAP;
  const maxY = container.bottom - container.top - toolbar.height - EDGE;
  return { x, y: Math.max(EDGE, Math.min(below, maxY)), side: "below" };
}
