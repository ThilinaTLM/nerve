import type { StatusTone } from "@nervekit/ui-kit/display/status";

/**
 * One compact fact rendered as a pill. Shared by tool card footers and
 * transcript notices so timeline metadata has a single visual family.
 */
export type MetaItem = {
  text: string;
  tone?: StatusTone;
  mono?: boolean;
  openPath?: string;
  href?: string;
};

/**
 * The leading argument shown beside a card's name: a command, a path, a link,
 * or any single identifying value.
 */
export type PrimaryArg = {
  text: string;
  openPath?: string;
  line?: number;
  href?: string;
  /** Preserve embedded whitespace for code/command-like values. */
  preserveWhitespace?: boolean;
};

/**
 * Named glyph vocabulary for card headers. Presentation logic stays pure
 * TypeScript by naming a glyph; `StatusGlyph` owns the icon components.
 *
 * - tool calls use the default circled family derived from their tone
 * - `pending` marks work that outlived the call (a promoted background task)
 * - the bell family and `compaction` belong to transcript notices
 */
export type CardGlyph =
  | "pending"
  | "bell"
  | "bell-ring"
  | "bell-dot"
  | "retry"
  | "compaction"
  | "branch"
  | "subagent"
  | "system";

/** A footer pill action, e.g. "View details" or "Open task". */
export type CardAction = {
  label: string;
  ariaLabel?: string;
  onClick: () => void;
};
