/**
 * Measures how many `PanelRow` entries fit inside a region so a list can fill the
 * available space exactly and hand the remainder to a "See more" affordance
 * instead of scrolling.
 */
export interface PanelRowFitOptions {
  /** Region that bounds the list; its height defines the budget. */
  readonly region: () => HTMLElement | null | undefined;
  /** Optional footer inside the region reserved below the list. */
  readonly footer?: () => HTMLElement | null | undefined;
  /** Total row count; re-measures whenever it changes. */
  readonly total: () => number;
}

export interface PanelRowFit {
  /** Rows that fit right now. Starts unbounded so the first paint is complete. */
  readonly count: number;
}

export function createPanelRowFit(options: PanelRowFitOptions): PanelRowFit {
  let count = $state(Number.MAX_SAFE_INTEGER);
  let rowHeight = 0;
  let frame: number | undefined;

  function measure(): void {
    const region = options.region();
    const list = region?.querySelector<HTMLElement>("[data-panel-list]");
    const row = list?.querySelector<HTMLElement>(".panel-row");
    if (row) rowHeight = row.getBoundingClientRect().height;
    if (!region || !list || rowHeight <= 0) return;

    const listStyle = getComputedStyle(list);
    const listPadding =
      Number.parseFloat(listStyle.paddingTop) +
      Number.parseFloat(listStyle.paddingBottom);
    const footerHeight =
      options.footer?.()?.getBoundingClientRect().height ?? 0;
    // Measuring from the list's top keeps section headers above it out of the budget.
    const available =
      region.getBoundingClientRect().bottom -
      list.getBoundingClientRect().top -
      footerHeight -
      listPadding;
    // Allow a small subpixel tolerance so app zoom and rem rounding do not
    // unnecessarily leave room for an additional complete row.
    const next = Math.max(0, Math.floor((available + 2) / rowHeight));
    if (next !== count) count = next;
  }

  function schedule(): void {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = undefined;
      measure();
    });
  }

  $effect(() => {
    const region = options.region();
    if (!region || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(schedule);
    observer.observe(region);
    schedule();
    return () => {
      observer.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  });

  $effect(() => {
    options.total();
    queueMicrotask(schedule);
  });

  return {
    get count() {
      return count;
    },
  };
}
