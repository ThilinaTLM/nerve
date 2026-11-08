/**
 * Sizing rules of the Git panel's three stacked areas, in pixels. One pure
 * calculation yields every height at once, so a change (toggle, content,
 * divider) moves all areas together in a single transition.
 *
 * - Collapsed sections are exactly their header.
 * - The lowest open area fills the panel: Changes, else the selected branch,
 *   else the list. Collapsed headers therefore stack at the bottom.
 * - Every other area is automatic (fits its content, up to AUTO_*_MAX) or has
 *   the height the user dragged.
 * - When height runs short, the filling area keeps its minimum: the list
 *   gives first, then the branch section.
 */

/** One-line section header (`h-8`): the height of a collapsed section. */
export const HEADER_PX = 32;
/** Automatic caps, as a share of the available height. */
export const AUTO_LIST_MAX = 0.5;
export const AUTO_BRANCH_MAX = 0.45;
/** Smallest list while it has rows; it scrolls below its content. */
export const MIN_LIST_PX = 56;
/** Smallest open branch section: its header plus one line. */
export const MIN_BRANCH_PX = HEADER_PX + 32;
/** Smallest open Changes section. */
export const MIN_CHANGES_PX = 96;

export interface SplitInput {
  /** Height shared by the areas (dividers excluded). */
  readonly totalPx: number;
  readonly hasList: boolean;
  /** Natural content height; 0 while unknown. */
  readonly listContentPx: number;
  /** Natural height of the open branch section, header included; 0 while unknown. */
  readonly branchContentPx: number;
  readonly branchOpen: boolean;
  readonly changesOpen: boolean;
  /** Manual heights as a share (0..1) of `totalPx`; null = automatic. */
  readonly listSize: number | null;
  readonly branchSize: number | null;
}

export interface SplitHeights {
  readonly list: number;
  readonly branch: number;
  readonly changes: number;
}

export type SplitArea = "list" | "branch" | "changes";

/** The area that takes the remaining height; none when nothing is open. */
export function fillingArea(
  input: Pick<SplitInput, "hasList" | "branchOpen" | "changesOpen">,
): SplitArea | undefined {
  if (input.changesOpen) return "changes";
  if (input.branchOpen) return "branch";
  return input.hasList ? "list" : undefined;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

export function splitHeights(input: SplitInput): SplitHeights {
  const total = Math.max(0, input.totalPx);
  const filler = fillingArea(input);

  const sized = {
    list: !input.hasList
      ? 0
      : input.listSize !== null
        ? Math.max(MIN_LIST_PX, input.listSize * total)
        : clamp(
            input.listContentPx || MIN_LIST_PX,
            Math.min(MIN_LIST_PX, input.listContentPx || MIN_LIST_PX),
            AUTO_LIST_MAX * total,
          ),
    branch: !input.branchOpen
      ? HEADER_PX
      : input.branchSize !== null
        ? Math.max(MIN_BRANCH_PX, input.branchSize * total)
        : clamp(
            input.branchContentPx || MIN_BRANCH_PX,
            MIN_BRANCH_PX,
            AUTO_BRANCH_MAX * total,
          ),
    changes: HEADER_PX,
  };
  if (!filler) return fit(sized, total);

  const minimum = {
    list: Math.min(MIN_LIST_PX, sized.list),
    branch: input.branchOpen ? MIN_BRANCH_PX : HEADER_PX,
    changes: MIN_CHANGES_PX,
  };
  // The filler keeps its minimum: the list gives first, then the branch.
  const others = (["list", "branch", "changes"] as const).filter(
    (area) => area !== filler,
  );
  const used = () => others.reduce((sum, area) => sum + sized[area], 0);
  let shortfall = minimum[filler] - (total - used());
  for (const area of ["list", "branch"] as const) {
    if (shortfall <= 0 || area === filler) continue;
    const give = Math.min(shortfall, sized[area] - minimum[area]);
    if (give > 0) {
      sized[area] -= give;
      shortfall -= give;
    }
  }
  sized[filler] = Math.max(0, total - used());
  return fit(sized, total);
}

/** Too little height for the minimums: shrink from the bottom up to fit exactly. */
function fit(heights: SplitHeights, total: number): SplitHeights {
  const result = { ...heights };
  let over = result.list + result.branch + result.changes - total;
  for (const area of ["changes", "list", "branch"] as const) {
    if (over <= 0) break;
    const give = Math.min(over, result[area]);
    result[area] -= give;
    over -= give;
  }
  return result;
}

/**
 * A divider resizes the area above it, which must be open and not the one
 * filling the panel (its height is whatever remains).
 */
export function draggable(
  divider: "list" | "branch",
  input: Pick<SplitInput, "hasList" | "branchOpen" | "changesOpen">,
): boolean {
  const filler = fillingArea(input);
  if (divider === "list") return input.hasList && filler !== "list";
  return input.branchOpen && filler === "changes";
}

/** The manual size a drag to `heightPx` stands for, as a share of the total. */
export function sizeFor(heightPx: number, totalPx: number): number | null {
  if (totalPx <= 0) return null;
  return clamp(heightPx / totalPx, 0.05, 0.9);
}
