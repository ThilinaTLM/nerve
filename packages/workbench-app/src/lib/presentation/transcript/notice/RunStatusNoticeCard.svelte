<script lang="ts">
import type { RunStatusNotice } from "../../state/transcript-types";
import NoticeCard from "./NoticeCard.svelte";
import { runStatusNoticeModel } from "./run-status-notice";

type Props = {
  notice: RunStatusNotice;
  isLast: boolean;
  sending: boolean;
  onContinueFromFailure?: (runId: string) => void;
};

let { notice, isLast, sending, onContinueFromFailure }: Props = $props();

let now = $state(Date.now());

$effect(() => {
  if (notice.state !== "retrying" || !notice.retryAt) return;
  now = Date.now();
  const interval = setInterval(() => {
    now = Date.now();
  }, 250);
  return () => clearInterval(interval);
});

const canContinue = $derived(
  notice.state !== "retrying" &&
    isLast &&
    !sending &&
    notice.retryable === true &&
    Boolean(notice.runId) &&
    Boolean(onContinueFromFailure),
);

const model = $derived(
  runStatusNoticeModel(notice, {
    nowMs: now,
    onContinue:
      canContinue && notice.runId
        ? () => onContinueFromFailure?.(notice.runId!)
        : undefined,
  }),
);

const layoutRevision = $derived(
  `${notice.state}:${canContinue ? "continue" : "static"}`,
);
</script>

<NoticeCard notice={model} {layoutRevision} bodyVisible={false} />
