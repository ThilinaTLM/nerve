<script lang="ts">
import type { Snippet } from "svelte";
import CardShell from "../../cards/CardShell.svelte";
import { VIEW_TOOL_DETAILS_LABEL } from "../../tools/views/tool-details-label";
import NoticeDetailsDialog from "./NoticeDetailsDialog.svelte";
import type {
  NoticeDetails,
  TranscriptNoticeModel,
} from "./notice-presentation";

type Props = {
  notice: TranscriptNoticeModel;
  /** Structural revision used to animate height changes between phases. */
  layoutRevision?: string;
  /** Whether the body snippet currently renders content. */
  bodyVisible?: boolean;
  /** Full content behind the collapsed body, opened from "View details". */
  details?: NoticeDetails;
  children?: Snippet;
};

let {
  notice,
  layoutRevision = "static",
  bodyVisible = false,
  details,
  children,
}: Props = $props();

let detailsOpen = $state(false);

const cardActions = $derived([
  ...(notice.action ? [notice.action] : []),
  ...(details
    ? [
        {
          label: VIEW_TOOL_DETAILS_LABEL,
          ariaLabel: `View ${notice.badge} details`,
          onClick: () => (detailsOpen = true),
        },
      ]
    : []),
]);

const summaryVisible = $derived(Boolean(notice.summary));
const showBody = $derived(bodyVisible || summaryVisible);
</script>

<CardShell
  glyph={notice.glyph}
  dotTone={notice.tone}
  dotPulse={notice.busy}
  statusLabel={notice.statusLabel}
  badge={notice.badge}
  arg={notice.arg ? { text: notice.arg } : undefined}
  error={notice.error}
  meta={notice.chips ?? []}
  {cardActions}
  primaryAction={notice.primaryAction}
  bodyVisible={showBody}
  {layoutRevision}
>
  {#if notice.summary}
    <p class="m-0 text-sm leading-6 text-muted-foreground">{notice.summary}</p>
  {/if}
  {#if bodyVisible && children}{@render children()}{/if}
</CardShell>

{#if details}
  <NoticeDetailsDialog bind:open={detailsOpen} {details} />
{/if}
