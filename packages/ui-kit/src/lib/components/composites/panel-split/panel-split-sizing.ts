/**
 * Sizing rules of a vertical stack of areas, in pixels. One pure calculation
 * yields every height at once, so a change (toggle, content, divider) moves
 * all areas together in a single transition.
 *
 * - A collapsed area is exactly its header.
 * - One open area fills the remaining height: the one with the highest `fill`
 *   priority (default: the lowest area). Collapsed headers below it stack at
 *   the bottom.
 * - Every other open area is automatic (fits its content, up to its
 *   `autoMaxShare`) or has the height the user dragged.
 * - When height runs short the filling area keeps its minimum: the other
 *   areas give, from the top down, until their own minimum.
 */

/** Describes one area of a {@link PanelSplit}, top to bottom in array order. */
export interface PanelSplitArea {
  /** Stable key; also the key in {@link PanelSplitLayout}. */
  readonly id: string;
  /** False keeps the area always open (no collapsed state). Default true. */
  readonly collapsible?: boolean;
  /** Start collapsed until the layout says otherwise. Default false. */
  readonly defaultCollapsed?: boolean;
  /** Smallest height while open, in px. */
  readonly minPx: number;
  /** Cap of the automatic height as a share (0..1) of the available height. Default 1. */
  readonly autoMaxShare?: number;
  /** The open area with the highest priority fills the rest. Default: its index. */
  readonly fill?: number;
  /** Height of the always-visible header in px; the height while collapsed. Default 0. */
  readonly headerPx?: number;
  /** Let the automatic height go below `minPx` when the content is shorter. */
  readonly fitContent?: boolean;
  /** Accessible name of the divider below this area. */
  readonly resizeLabel?: string;
}

/**
 * Plain serializable layout state. Absent entries mean the area default
 * (`defaultCollapsed`, automatic size).
 */
export interface PanelSplitLayout {
  /** Collapsed flag per area id. */
  readonly collapsed: Readonly<Record<string, boolean>>;
  /** Manual height per area id as a share (0..1) of the available height. */
  readonly sizes: Readonly<Record<string, number>>;
}

/** A new empty `PanelSplitLayout`: nothing collapsed, no dragged sizes. */
export const emptyPanelSplitLayout = (): PanelSplitLayout => ({
  collapsed: {},
  sizes: {},
});

export interface PanelSplitInput {
  readonly areas: readonly PanelSplitArea[];
  readonly layout: PanelSplitLayout;
  /** Height shared by the areas (dividers excluded). */
  readonly totalPx: number;
  /** Natural height per area id, header included; missing or 0 while unknown. */
  readonly contentPx: Readonly<Record<string, number>>;
}

export function isAreaOpen(
  area: PanelSplitArea,
  layout: PanelSplitLayout,
): boolean {
  if (area.collapsible === false) return true;
  return !(layout.collapsed[area.id] ?? area.defaultCollapsed ?? false);
}

/** Index of the area that takes the remaining height; -1 when nothing is open. */
export function fillingIndex(
  areas: readonly PanelSplitArea[],
  layout: PanelSplitLayout,
): number {
  let best = -1;
  let bestPriority = -Infinity;
  areas.forEach((area, index) => {
    if (!isAreaOpen(area, layout)) return;
    const priority = area.fill ?? index;
    if (priority >= bestPriority) {
      best = index;
      bestPriority = priority;
    }
  });
  return best;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

/** Heights of all areas, in the order of `input.areas`. */
export function panelSplitHeights(input: PanelSplitInput): number[] {
  const { areas, layout } = input;
  const total = Math.max(0, input.totalPx);
  const filler = fillingIndex(areas, layout);

  const sized = areas.map((area) => {
    if (!isAreaOpen(area, layout)) return area.headerPx ?? 0;
    const manual = layout.sizes[area.id];
    if (manual !== undefined) return Math.max(area.minPx, manual * total);
    const content = input.contentPx[area.id] || 0;
    const lower = area.fitContent
      ? Math.min(area.minPx, content || area.minPx)
      : area.minPx;
    return clamp(
      content || area.minPx,
      lower,
      (area.autoMaxShare ?? 1) * total,
    );
  });
  if (filler < 0) return fit(sized, total);

  const others = sized.map((_, index) => index).filter((i) => i !== filler);
  const used = () => others.reduce((sum, i) => sum + sized[i]!, 0);
  let shortfall = areas[filler]!.minPx - (total - used());
  for (const i of others) {
    if (shortfall <= 0) break;
    const give = Math.min(
      shortfall,
      sized[i]! - minimumOf(areas[i]!, sized[i]!, layout),
    );
    if (give > 0) {
      sized[i]! -= give;
      shortfall -= give;
    }
  }
  sized[filler] = Math.max(0, total - used());
  return fit(sized, total);
}

/** What an area gives up to: nothing while collapsed, else its minimum. */
function minimumOf(
  area: PanelSplitArea,
  sizedPx: number,
  layout: PanelSplitLayout,
): number {
  return isAreaOpen(area, layout) ? Math.min(area.minPx, sizedPx) : sizedPx;
}

/** Too little height for the minimums: shrink from the bottom up to fit exactly. */
function fit(heights: number[], total: number): number[] {
  const result = [...heights];
  let over = result.reduce((sum, px) => sum + px, 0) - total;
  for (let i = result.length - 1; i >= 0 && over > 0; i--) {
    const give = Math.min(over, result[i]!);
    result[i]! -= give;
    over -= give;
  }
  return result;
}

/**
 * The divider below `index` resizes the area above it, which must be open
 * and not the one filling the panel (its height is whatever remains).
 */
export function isDividerDraggable(
  areas: readonly PanelSplitArea[],
  layout: PanelSplitLayout,
  index: number,
): boolean {
  const area = areas[index];
  if (!area || !isAreaOpen(area, layout)) return false;
  const filler = fillingIndex(areas, layout);
  return filler >= 0 && filler !== index;
}

/** The manual size a drag to `heightPx` stands for, as a share of the total. */
export function sizeFor(heightPx: number, totalPx: number): number | null {
  if (totalPx <= 0) return null;
  return clamp(heightPx / totalPx, 0.05, 0.9);
}

/** A layout with one area's collapsed flag set. */
export function withCollapsed(
  layout: PanelSplitLayout,
  id: string,
  collapsed: boolean,
): PanelSplitLayout {
  return { ...layout, collapsed: { ...layout.collapsed, [id]: collapsed } };
}

/** A layout with one area's manual size set; `null` makes it automatic. */
export function withSize(
  layout: PanelSplitLayout,
  id: string,
  size: number | null,
): PanelSplitLayout {
  const rest = Object.fromEntries(
    Object.entries(layout.sizes).filter(([key]) => key !== id),
  );
  return { ...layout, sizes: size === null ? rest : { ...rest, [id]: size } };
}
