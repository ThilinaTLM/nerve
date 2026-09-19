import type { StatusTone } from "@nervekit/ui-kit/display/status";
import type { CompactionNotice } from "../../state/transcript-types";
import type { CardGlyph } from "../../cards/card-presentation";

export type CompactionNoticeHeader = {
  tone: StatusTone;
  glyph: CardGlyph;
  busy: boolean;
  badge: string;
  arg: string;
  statusLabel: string;
};

function reasonLabel(notice: CompactionNotice): string {
  if (notice.reason === "threshold") return "auto compact";
  if (notice.reason === "overflow") return "overflow recovery";
  return "manual";
}

export function compactionNoticeHeader(
  notice: CompactionNotice,
): CompactionNoticeHeader {
  const arg = reasonLabel(notice);
  switch (notice.state) {
    case "running":
      return {
        tone: "info",
        glyph: "compaction",
        busy: true,
        badge: "compacting",
        arg,
        statusLabel: "Compacting the conversation context",
      };
    case "cancelled":
      return {
        tone: "warning",
        glyph: "compaction",
        busy: false,
        badge: "compact stopped",
        arg,
        statusLabel: "Compaction stopped",
      };
    case "failed":
      return {
        tone: "destructive",
        glyph: "bell-dot",
        busy: false,
        badge: "compact failed",
        arg,
        statusLabel: "Compaction failed",
      };
    default:
      return {
        tone: "success",
        glyph: "compaction",
        busy: false,
        badge: "compacted",
        arg,
        statusLabel: "Context compacted",
      };
  }
}
