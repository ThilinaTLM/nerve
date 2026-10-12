<script lang="ts">
import type { Snippet } from "svelte";

type Props = {
  /** When true, render transcript + composer; otherwise render the empty state. */
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

let transcriptEl = $state<HTMLDivElement>();
let activityHeight = $state(0);
$effect(() => {
  const element = transcriptEl;
  if (!element) return;
  const update = () => {
    activityHeight = element.clientHeight;
  };
  const observer = new ResizeObserver(update);
  update();
  observer.observe(element);
  return () => observer.disconnect();
});
</script>

<section
  class="relative grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] bg-background"
  style:--conversation-activity-height={`${activityHeight}px`}
>
  {#if open}
    <div bind:this={transcriptEl} class="grid min-h-0 min-w-0">
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
