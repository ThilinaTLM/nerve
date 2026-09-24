import type { StatusTone } from "@nervekit/ui-kit/display/status";
import type {
  CardAction,
  CardGlyph,
  MetaItem,
} from "../../cards/card-presentation";

/**
 * Transcript notices are the shared presentation for system events in a
 * conversation timeline (background tasks, run retries and failures,
 * compaction, and future event kinds). They deliberately reuse the tool card
 * anatomy — same gutter, header, output well, chips and footer pill — so the
 * transcript reads as one stream of processes. The only difference is the
 * leading glyph: notices own the bell family, tool calls own the circled one.
 */
export type NoticeChip = MetaItem;

export type NoticeAction = CardAction;

/**
 * Full content behind a notice's collapsed body. The transcript only shows a
 * fixed six-line preview; this content opens from the "View details" footer.
 */
export type NoticeDetails = {
  title: string;
  description?: string;
  text: string;
  language?: string;
};

export type TranscriptNoticeModel = {
  /** Notice family, e.g. "task" | "run" | "compaction". */
  kind: string;
  tone: StatusTone;
  glyph: CardGlyph;
  /** Spin the leading glyph while the event is still in flight. */
  busy?: boolean;
  /** Snake-case mono event name in the tool-name slot, e.g. "task_completed". */
  badge: string;
  /** Muted argument beside the name: task name, reason, failure summary. */
  arg?: string;
  /** Accessible description of the event. */
  statusLabel: string;
  /** Optional muted sentence rendered in the card body. */
  summary?: string;
  /** Failure text rendered in the shared error surface. */
  error?: string;
  /** Facts that are not already in the header. */
  chips?: NoticeChip[];
  /** At most one passive footer action, styled like "View details". */
  action?: NoticeAction;
  /** At most one recovery-critical footer action rendered as a primary control. */
  primaryAction?: NoticeAction;
};
