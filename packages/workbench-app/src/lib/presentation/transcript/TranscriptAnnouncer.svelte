<script lang="ts">
import {
  transcriptAnnouncementForTransition,
  type TranscriptAnnouncementState,
} from "./transcript-announcement";

type Props = TranscriptAnnouncementState;

let {
  active,
  sending,
  pendingApprovalId,
  pendingApprovalCount,
  pendingQuestionIds,
  pendingPlanReviewIds,
}: Props = $props();

let announcement = $state("");
let sequence = $state(0);
let previous: TranscriptAnnouncementState | undefined;

$effect(() => {
  const current: TranscriptAnnouncementState = {
    active,
    sending,
    pendingApprovalId,
    pendingApprovalCount,
    pendingQuestionIds,
    pendingPlanReviewIds,
  };
  const next = transcriptAnnouncementForTransition(previous, current);
  previous = current;
  if (!next) return;
  announcement = next;
  sequence += 1;
});
</script>

<div class="sr-only" role="status" aria-live="polite" aria-atomic="true">
  {#key sequence}<span>{announcement}</span>{/key}
</div>
