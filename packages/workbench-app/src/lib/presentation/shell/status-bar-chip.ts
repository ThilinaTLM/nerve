/**
 * Every status-bar item — the project/git info on the left, the alert chips,
 * and the popover triggers on the right — shares one chip shape so the footer
 * reads as a single row instead of two differently shaped clusters.
 *
 * The chip sits on the shared control scale: `h-6` (xs) on desktop, stepping up
 * to `h-9` (lg) below `sm` so the footer stays touch friendly on phones.
 */
export const STATUS_BAR_CHIP =
  "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-sm px-1.5 text-xs text-muted-foreground tabular-nums max-sm:h-9 max-sm:px-2.5";

/** Interactive variant: same shape, with the shared ghost hover/open feedback. */
export const STATUS_BAR_CHIP_BUTTON = `${STATUS_BAR_CHIP} cursor-pointer transition-colors hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground`;
