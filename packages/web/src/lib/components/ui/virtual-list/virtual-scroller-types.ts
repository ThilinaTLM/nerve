import type { Snippet } from "svelte";

export type VirtualScrollerAnchor = "start" | "end";

export type VirtualScrollBehavior = "auto" | "smooth" | "instant";

export type VirtualScrollAlignment = "start" | "center" | "end" | "auto";

export type VirtualScrollToIndexOptions = {
  align?: VirtualScrollAlignment;
  behavior?: VirtualScrollBehavior;
};

/**
 * Imperative handle surfaced through the `controller` bindable prop. Methods
 * proxy to the underlying TanStack virtualizer instance.
 */
export type VirtualScrollerController = {
  scrollToEnd: (opts?: { behavior?: VirtualScrollBehavior }) => void;
  scrollToIndex: (index: number, opts?: VirtualScrollToIndexOptions) => void;
  isAtEnd: (threshold?: number) => boolean;
  getDistanceFromEnd: () => number;
  measureAll: () => void;
};

export type VirtualScrollerProps<T> = {
  /** Source items. Identity is tracked via {@link getKey}. */
  items: T[];
  /** Stable identity for an item (used as the virtualizer item key). */
  getKey: (item: T, index: number) => string | number;
  /** Estimated row height in px before measurement. Defaults to 64. */
  estimateSize?: (index: number) => number;
  /** Extra rows rendered above/below the viewport. Defaults to 8. */
  overscan?: number;
  /** Anchor new content to the start (default) or end (chat tail) of the list. */
  anchor?: VirtualScrollerAnchor;
  /** Follow appended content when already pinned to the end. */
  followOutput?: boolean | "smooth";
  /** Distance from the end (px) still considered "at end". */
  scrollEndThreshold?: number;
  /** Spacer above the first row (px). */
  paddingStart?: number;
  /** Spacer below the last row (px), e.g. to clear a docked composer. */
  paddingEnd?: number;
  /** Gap between rows (px). */
  gap?: number;
  /** Bindable imperative controller. */
  controller?: VirtualScrollerController;
  /** Bindable reactive flag: is the viewport currently at the end. */
  atEnd?: boolean;
  /** Class applied to the scrolling viewport element. */
  viewportClass?: string;
  /** Class applied to the inner sized spacer element. */
  class?: string;
  /** Row renderer. */
  row: Snippet<[{ item: T; index: number }]>;
};
