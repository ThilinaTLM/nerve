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
