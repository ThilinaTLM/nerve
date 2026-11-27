<!--
  @component
  Floating marker at the top centre of a conversation pane while configuration
  waits for the user's trust: "N waiting for your review" and Later. A fade
  band under the tab strip keeps it off the transcript's text. It has no list:
  it opens the bell island (desktop) or the review queue (phone). On a new
  item it pulses with the island's arrival.
-->
<script lang="ts">
import BellDot from "@lucide/svelte/icons/bell-dot";
import X from "@lucide/svelte/icons/x";
import { backOut, cubicIn } from "svelte/easing";
import { prefersReducedMotion } from "svelte/motion";
import { fade } from "svelte/transition";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import { waitingLabel } from "./attention-island";

let {
  count,
  pulse = 0,
  pulsing = false,
  openLabel = "show the list",
  onOpen,
  onLater,
}: {
  count: number;
  /** Changes on every new item: the entrance and the pulse play again. */
  pulse?: number;
  /** The island shows the new item right now; the ring pulses with it. */
  pulsing?: boolean;
  /** What opening does, for the accessible name. */
  openLabel?: string;
  onOpen: () => void;
  onLater: () => void;
} = $props();

const label = $derived(waitingLabel(count));
let stopped = $state(false);
$effect(() => {
  void pulse;
  stopped = false;
});

function motionMs(node: Element, scale: number): number {
  if (prefersReducedMotion.current) return 0;
  const token = getComputedStyle(node).getPropertyValue(
    "--motion-enter-duration",
  );
  return (parseFloat(token) || 0) * scale;
}
/** Drops in from the tab strip and settles. */
function markerIn(node: HTMLElement) {
  return {
    duration: motionMs(node, 1.6),
    easing: backOut,
    css: (t: number) =>
      `opacity: ${Math.min(1, t * 2)}; transform: translateY(${(1 - t) * -10}px) scale(${0.92 + 0.08 * t});`,
  };
}
function markerOut(node: HTMLElement) {
  return {
    duration: motionMs(node, 0.6),
    easing: cubicIn,
    css: (t: number) =>
      `opacity: ${t}; transform: translateY(${(1 - t) * -6}px) scale(${0.96 + 0.04 * t});`,
  };
}
</script>

<div
  class="pointer-events-none absolute inset-x-0 top-0 z-10 h-14 bg-linear-to-b from-background via-background to-transparent"
  aria-hidden="true"
  transition:fade={{ duration: 120 }}
></div>
<div
  class="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center px-3 pt-3"
  data-attention-island
  out:markerOut
>
  {#key pulse}
    <div
      class="pointer-events-auto relative min-w-0"
      in:markerIn
      role="presentation"
      onmouseenter={() => (stopped = true)}
    >
      {#if pulsing && !stopped}
        <span
          class="attention-ring pointer-events-none absolute inset-0 rounded-full text-warning"
          aria-hidden="true"
        ></span>
      {/if}
      <!-- Opaque popover base under the warning tint, so text never shows through. -->
      <div
        class="flex h-control max-w-full items-center overflow-hidden rounded-full border border-warning-strong bg-popover shadow-overlay"
        role="status"
      >
        <div class="flex h-full min-w-0 items-center bg-warning-subtle pr-0.5">
          <button
            type="button"
            class="flex h-full min-w-0 cursor-pointer items-center gap-2 rounded-full pr-1.5 pl-3 text-ui font-medium text-foreground hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus"
            aria-label={`${label}, ${openLabel}`}
            onclick={onOpen}
          >
            <BellDot
              class="size-3.5 shrink-0 text-warning"
              aria-hidden="true"
            />
            <span class="truncate tabular-nums">{label}</span>
          </button>
          <IconAction icon={X} label="Later" onclick={onLater} />
        </div>
      </div>
    </div>
  {/key}
</div>
