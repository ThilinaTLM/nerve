<script lang="ts">
import { compactionAccountingSchema } from "@nervekit/contracts/core";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import X from "@lucide/svelte/icons/x";
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
  /** Cancels a pending (queued) request; running compaction uses Stop. */
  onCancelCompaction?: () => void;
};

let { notice, onCancelCompaction }: Props = $props();

const cancelable = $derived(
  notice.state === "queued" && Boolean(onCancelCompaction),
);

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

const details = $derived(recordValue(notice.details));
const accounting = $derived(
  compactionAccountingSchema.safeParse(details?.accounting).data,
);
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
const draftText = $derived(notice.summaryPreview?.trimEnd() ?? "");
const previewText = $derived.by(() => {
  if (notice.state !== "completed") return draftText;
  const summary = (notice.summary ?? notice.text ?? "").trimEnd();
  if (!summary) return "";
  return splitLogicalLines(summary).slice(-COLLAPSED_LINES).join("\n");
});

const summaryDetails = $derived.by(() => {
  if (notice.state !== "completed") return undefined;
  const summary = (notice.summary ?? notice.text ?? "").trim();
  return summary
    ? {
        title: "Compaction summary",
        description: accounting
          ? `${header.arg ?? ""} · Conversation estimate: ${formatTokens(accounting.summaryTokens)} summary + ${formatTokens(accounting.retainedTokens)} retained across ${accounting.retainedMessages} messages. Excludes system/tool/provider overhead.${accounting.retentionBudgetExceeded ? " Newest intact message/tool group exceeds the retention target." : ""}`
          : header.arg,
        text: summary,
        language: "markdown",
      }
    : undefined;
});

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
      text: `≈${formatTokens(notice.freedTokens)} freed`,
      tone: header.tone === "warning" ? "warning" : "success",
    });
  }
  if (typeof compactedMessages === "number") {
    items.push({ text: `${compactedMessages} summarized` });
  }
  if (accounting?.retentionBudgetExceeded) {
    items.push({ text: "retained group exceeds target", tone: "warning" });
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
  return items;
});

const draftChips = $derived.by<NoticeChip[]>(() =>
  draftText ? [{ text: "uncommitted draft", tone: "warning" }] : [],
);
const chips = $derived(
  notice.state === "completed"
    ? completedChips
    : notice.state === "running"
      ? runningChips
      : draftChips,
);

const errorMessage = $derived(
  notice.state === "failed" && !notice.code
    ? notice.errorMessage?.trim() || "Could not compact this conversation."
    : undefined,
);

const summary = $derived.by(() => {
  if (notice.state === "queued") {
    return "Compaction pending. It runs at the next safe point.";
  }
  if (notice.state === "running" && !previewText) {
    return notice.stopping
      ? "Stopping compaction…"
      : "Summarizing recent work…";
  }
  if (notice.state === "cancelled") {
    return "Compaction stopped early. Conversation history is unchanged.";
  }
  if (notice.state === "failed" && notice.code) {
    return (
      notice.errorMessage?.trim() || "Could not compact this conversation."
    );
  }
  if (notice.state === "completed" && header.tone === "warning") {
    return header.statusLabel;
  }
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
    errorVisible: Boolean(errorMessage),
    footerItemCount:
      chips.length + (summaryDetails ? 1 : 0) + (cancelable ? 1 : 0),
  }),
);
</script>

{#snippet cancelAction()}
  <Button
    variant="ghost"
    size="icon-sm"
    ariaLabel="Cancel compaction"
    onclick={() => onCancelCompaction?.()}
  >
    <X aria-hidden="true" />
  </Button>
{/snippet}

<NoticeCard
  notice={model}
  {layoutRevision}
  {bodyVisible}
  details={summaryDetails}
  actions={cancelable ? cancelAction : undefined}
>
  <ResultCodeBlock
    code={previewText}
    language="markdown"
    trim={false}
    wrap
    overflow="hidden"
    tail
    live={notice.state === "running"}
    caret={notice.state === "running" && !notice.stopping}
    streamMotion={notice.state === "running"}
    progressiveHighlight
    fixedRows={COLLAPSED_LINES}
  />
</NoticeCard>
