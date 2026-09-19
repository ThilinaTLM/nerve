<script lang="ts">
import type { CompactionNotice } from "../../state/transcript-types";
import { formatTokens } from "@nervekit/ui-kit/display/usage";
import ResultCodeBlock from "../../tools/tool-call/ResultCodeBlock.svelte";
import {
  COLLAPSED_LINES,
  splitLogicalLines,
} from "../../tools/views/tool-view-helpers";
import NoticeCard from "./NoticeCard.svelte";
import {
  compactionCardBodyKind,
  compactionCardLayoutRevision,
} from "./compaction-card-layout";
import { compactionNoticeHeader } from "./compaction-notice";
import type { NoticeChip } from "./notice-presentation";

type Props = {
  notice: CompactionNotice;
};

let { notice }: Props = $props();

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

const details = $derived(recordValue(notice.details));
const compactedMessages = $derived(
  typeof details?.compactedMessages === "number"
    ? details.compactedMessages
    : undefined,
);

const header = $derived(compactionNoticeHeader(notice));

const contextPercent = $derived.by(() => {
  const used = notice.contextTokens ?? notice.tokensBefore;
  if (!used || !notice.contextWindow) return undefined;
  return Math.round((used / notice.contextWindow) * 100);
});

/**
 * Trailing lines of the checkpoint: the live draft while summarizing, and the
 * committed summary once done, so the body never jumps at completion.
 */
const previewText = $derived.by(() => {
  if (notice.state === "running") return notice.summaryPreview?.trimEnd() ?? "";
  if (notice.state !== "completed") return "";
  const summary = (notice.summary ?? notice.text ?? "").trimEnd();
  if (!summary) return "";
  return splitLogicalLines(summary).slice(-COLLAPSED_LINES).join("\n");
});

let now = $state(Date.now());
$effect(() => {
  if (notice.state !== "running") return;
  const interval = setInterval(() => {
    now = Date.now();
  }, 250);
  return () => clearInterval(interval);
});

const startedAtMs = $derived(
  notice.createdAt ? Date.parse(notice.createdAt) : Number.NaN,
);
const elapsedSeconds = $derived.by(() => {
  if (notice.state !== "running" || Number.isNaN(startedAtMs)) return undefined;
  return Math.max(0, Math.floor((now - startedAtMs) / 1000));
});
const elapsedLabel = $derived(
  elapsedSeconds === undefined
    ? undefined
    : `${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, "0")}`,
);
// Delay appearance so an instant compaction does not flash a "0:00".
const showElapsed = $derived(
  elapsedSeconds !== undefined && elapsedSeconds >= 1,
);

const completedChips = $derived.by<NoticeChip[]>(() => {
  const items: NoticeChip[] = [];
  if (typeof notice.tokensBefore === "number") {
    items.push({ text: `${formatTokens(notice.tokensBefore)} before` });
  }
  if (typeof notice.tokensAfter === "number") {
    items.push({ text: `≈${formatTokens(notice.tokensAfter)} after` });
  }
  if (typeof notice.freedTokens === "number" && notice.freedTokens > 0) {
    items.push({
      text: `${formatTokens(notice.freedTokens)} freed`,
      tone: "success",
    });
  }
  if (typeof compactedMessages === "number") {
    items.push({ text: `${compactedMessages} messages` });
  }
  if (typeof contextPercent === "number") {
    items.push({ text: `${contextPercent}% context` });
  }
  return items;
});

const runningChips = $derived.by<NoticeChip[]>(() => {
  const items: NoticeChip[] = [];
  const before = notice.contextTokens ?? notice.tokensBefore;
  if (typeof before === "number") {
    items.push({ text: `${formatTokens(before)} before` });
  }
  if (typeof contextPercent === "number") {
    items.push({ text: `${contextPercent}% context` });
  }
  if (typeof notice.generatedLines === "number" && notice.generatedLines > 0) {
    items.push({ text: `${notice.generatedLines} lines` });
  }
  if (showElapsed && elapsedLabel) {
    items.push({ text: elapsedLabel });
  }
  return items;
});

const chips = $derived(
  notice.state === "completed"
    ? completedChips
    : notice.state === "running"
      ? runningChips
      : [],
);

const errorMessage = $derived(
  notice.state === "failed"
    ? notice.errorMessage?.trim() || "Could not compact this conversation."
    : undefined,
);

const summary = $derived.by(() => {
  if (notice.state === "running" && !previewText) {
    return "Summarizing recent work…";
  }
  if (notice.state === "cancelled") return "Compaction stopped early.";
  return undefined;
});

const model = $derived({
  kind: "compaction",
  tone: header.tone,
  glyph: header.glyph,
  busy: header.busy,
  badge: header.badge,
  arg: header.arg,
  statusLabel: header.statusLabel,
  summary,
  error: errorMessage,
  chips,
});

const bodyVisible = $derived(previewText.length > 0);
const layoutRevision = $derived(
  compactionCardLayoutRevision({
    state: notice.state,
    bodyKind: compactionCardBodyKind({
      bodyVisible,
      previewVisible: previewText.length > 0,
    }),
    errorVisible: notice.state === "failed",
    footerItemCount: chips.length,
  }),
);
</script>

<NoticeCard notice={model} {layoutRevision} {bodyVisible}>
  <ResultCodeBlock
    code={previewText}
    language="markdown"
    trim={false}
    wrap
    overflow="hidden"
    tail
    fixedRows={COLLAPSED_LINES}
  />
</NoticeCard>
