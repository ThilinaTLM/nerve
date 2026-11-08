/**
 * Sizing rules of the Git panel's three stacked areas, in pixels. One pure
 * calculation yields every height at once, so a change (toggle, content,
 * divider) moves all areas together in a single transition.
 *
 * - List: fits its rows, capped (user cap, else AUTO_LIST_MAX).
 * - Selected branch: fits its content, capped (user cap, else AUTO_BRANCH_MAX).
 * - Changes: takes the rest. Collapsed, the rest goes to the list (or to the
 *   branch section when there is no list).
 * - Collapsed sections are their one-line header.
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
  /** User caps as a share (0..1) of `totalPx`; null = automatic. */
  readonly listCap: number | null;
  readonly branchCap: number | null;
}

export interface SplitHeights {
  readonly list: number;
  readonly branch: number;
  readonly changes: number;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

export function splitHeights(input: SplitInput): SplitHeights {
  const total = Math.max(0, input.totalPx);
  const { hasList, branchOpen, changesOpen } = input;

  let branch = HEADER_PX;
  if (branchOpen) {
    const cap = (input.branchCap ?? AUTO_BRANCH_MAX) * total;
    const content = input.branchContentPx || MIN_BRANCH_PX;
    branch = clamp(content, MIN_BRANCH_PX, cap);
  }
  let list = 0;
  if (hasList) {
    const cap = (input.listCap ?? AUTO_LIST_MAX) * total;
    const content = input.listContentPx || MIN_LIST_PX;
    list = clamp(content, Math.min(MIN_LIST_PX, content), cap);
  }

  if (!changesOpen) {
    // The rest goes to the list, else to the branch section.
    const rest = total - HEADER_PX - branch - list;
    if (hasList) list = Math.max(0, list + rest);
    else branch = Math.max(HEADER_PX, branch + rest);
    return fit({ list, branch, changes: HEADER_PX }, total, hasList);
  }

  // Changes keeps its minimum: the list gives first, then the branch section.
  let shortfall = MIN_CHANGES_PX - (total - list - branch);
  if (shortfall > 0 && hasList) {
    const give = Math.min(shortfall, list - Math.min(MIN_LIST_PX, list));
    list -= give;
    shortfall -= give;
  }
  if (shortfall > 0 && branchOpen) {
    const give = Math.min(shortfall, branch - MIN_BRANCH_PX);
    branch -= give;
  }
  return fit(
    { list, branch, changes: Math.max(0, total - list - branch) },
    total,
    hasList,
  );
}

/** Too little height for the minimums: shrink from the bottom up to fit exactly. */
function fit(
  heights: SplitHeights,
  total: number,
  hasList: boolean,
): SplitHeights {
  let { list, branch, changes } = heights;
  let over = list + branch + changes - total;
  if (over <= 0) return { list, branch, changes };
  for (const take of ["changes", "list", "branch"] as const) {
    if (take === "list" && !hasList) continue;
    const value =
      take === "changes" ? changes : take === "list" ? list : branch;
    const give = Math.min(over, value);
    if (take === "changes") changes -= give;
    else if (take === "list") list -= give;
    else branch -= give;
    over -= give;
    if (over <= 0) break;
  }
  return { list, branch, changes };
}

/** A divider can be dragged only where the area above it is fit-sized. */
export function draggable(
  divider: "list" | "branch",
  input: Pick<SplitInput, "hasList" | "branchOpen" | "changesOpen">,
): boolean {
  if (divider === "list") return input.hasList && input.changesOpen;
  return input.branchOpen && (input.changesOpen || input.hasList);
}

/** The cap a drag to `heightPx` stands for, as a share of the total. */
export function capFor(heightPx: number, totalPx: number): number | null {
  if (totalPx <= 0) return null;
  return clamp(heightPx / totalPx, 0.05, 0.9);
}
