<script lang="ts">
import type { Snippet } from "svelte";

/**
 * Phone counterpart of `ConversationPaneLayout`: a narrower content gutter,
 * no scrollbar lane (phone scrollbars overlay the content), and the composer
 * docked to the bottom edge instead of floating in the content column.
 */
type Props = {
  open: boolean;
  composerWrapRef?: HTMLElement | null;
  transcript: Snippet;
  composer: Snippet;
  empty: Snippet;
  announcer?: Snippet;
};

let {
  open,
  composerWrapRef = $bindable(),
  transcript,
  composer,
  empty,
  announcer,
}: Props = $props();

let transcriptHeight = $state(0);
</script>

<section
  class="relative grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] bg-background"
  style:--conversation-activity-height={`${transcriptHeight}px`}
  style:--conversation-content-inset="1rem"
>
  {#if open}
    <div bind:clientHeight={transcriptHeight} class="grid min-h-0 min-w-0">
      {@render transcript()}
    </div>
    {#if announcer}{@render announcer()}{/if}
    <div bind:this={composerWrapRef} class="min-w-0">
      {@render composer()}
    </div>
  {:else}
    {@render empty()}
  {/if}
</section>
