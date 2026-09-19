<script lang="ts">
import type { Snippet } from "svelte";
import CardShell from "../../cards/CardShell.svelte";
import type { TranscriptNoticeModel } from "./notice-presentation";

type Props = {
  notice: TranscriptNoticeModel;
  /** Structural revision used to animate height changes between phases. */
  layoutRevision?: string;
  /** Whether the body snippet currently renders content. */
  bodyVisible?: boolean;
  children?: Snippet;
};

let {
  notice,
  layoutRevision = "static",
  bodyVisible = false,
  children,
}: Props = $props();

const cardActions = $derived(notice.action ? [notice.action] : []);

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
  bodyVisible={showBody}
  {layoutRevision}
>
  {#if notice.summary}
    <p class="m-0 text-sm leading-6 text-muted-foreground">{notice.summary}</p>
  {/if}
  {#if bodyVisible && children}{@render children()}{/if}
</CardShell>
