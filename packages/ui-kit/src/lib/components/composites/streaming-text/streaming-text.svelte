<script lang="ts">
import { untrack } from "svelte";
import { prefersReducedMotion } from "svelte/motion";
import { StreamingFadeTracker } from "@nervekit/ui-kit/scheduling/streaming-fade";
import { fadeAge } from "./fade-age.js";

type Props = {
  /** A growing plain string; appended text fades in. */
  text: string;
  /** Disable to render plain text (bursts, non-live content). */
  fade?: boolean;
};

let { text, fade = true }: Props = $props();

// Text present at mount is settled, so remounts never replay the fade.
const tracker = new StreamingFadeTracker({
  initialText: untrack(() => text),
});

const segments = $derived.by(() => {
  const now = performance.now();
  tracker.update(text, now);
  if (!fade || prefersReducedMotion.current) {
    tracker.settle();
    return [{ start: 0, end: text.length, fresh: false, ageMs: 0 }];
  }
  return tracker.segments(0, text.length, now);
});
</script>

{#each segments as segment (segment.start)}{#if segment.fresh}<span
      class="stream-fresh"
      use:fadeAge={segment.ageMs}>{text.slice(segment.start, segment.end)}</span
    >{:else}{text.slice(segment.start, segment.end)}{/if}{/each}
