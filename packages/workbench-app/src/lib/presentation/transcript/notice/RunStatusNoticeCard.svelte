<script lang="ts">
import type { CoreTimelineRow } from "../../state/transcript-types";
import NoticeCard from "./NoticeCard.svelte";
import type { TranscriptNoticeModel } from "./notice-presentation";
let {
  notice,
  onContinue,
}: {
  notice: Extract<CoreTimelineRow, { kind: "run_status" }>["notice"];
  onContinue?: () => void;
} = $props();
let now = $state(Date.now());
$effect(() => {
  if (notice.state !== "retrying") return;
  const timer = setInterval(() => (now = Date.now()), 1000);
  return () => clearInterval(timer);
});
const remaining = $derived(
  notice.retryAt
    ? Math.max(0, Math.ceil((Date.parse(notice.retryAt) - now) / 1000))
    : undefined,
);
const model = $derived<TranscriptNoticeModel>({
  kind: "run",
  tone:
    notice.state === "failed" || notice.state === "retry_exhausted"
      ? "destructive"
      : "warning",
  glyph: notice.state === "retrying" ? "retry" : "bell-dot",
  busy: notice.state === "retrying",
  badge: `run_${notice.state}`,
  statusLabel:
    notice.state === "retrying"
      ? `Retrying${remaining ? ` in ${remaining}s` : ""}`
      : notice.state,
  arg: notice.errorMessage,
  chips: [
    ...(notice.attempt
      ? [{ text: `retry ${notice.attempt}/${notice.maxRetries}` }]
      : []),
    ...(notice.state === "retrying" && remaining !== undefined
      ? [{ text: `${remaining}s` }]
      : []),
  ],
  primaryAction:
    notice.canContinue && onContinue
      ? { label: "Continue", onClick: onContinue }
      : undefined,
});
</script>
<NoticeCard notice={model} />
