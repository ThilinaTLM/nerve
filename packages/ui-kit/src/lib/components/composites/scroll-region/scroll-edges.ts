/** Geometry behind the edge shadows of a scroll region.
 *
 * Kept pure so the "is there more above/below" rule is testable without a
 * layout engine; the component only feeds it live viewport metrics. */
export type ScrollMetrics = {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
};

export type ScrollEdges = {
  top: boolean;
  bottom: boolean;
};

/** Sub-pixel layout rounding must not flicker a shadow, hence the slack. */
export const SCROLL_EDGE_THRESHOLD = 2;

export function scrollEdges(
  metrics: ScrollMetrics,
  threshold = SCROLL_EDGE_THRESHOLD,
): ScrollEdges {
  return {
    top: metrics.scrollTop > threshold,
    bottom:
      metrics.scrollTop + metrics.clientHeight <
      metrics.scrollHeight - threshold,
  };
}
