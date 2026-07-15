<script lang="ts">
import type { Snippet } from "svelte";
import { prefersReducedMotion } from "svelte/motion";
import {
  createToolActivityMotion,
  type ToolActivityMotionController,
} from "./tool-activity-motion";

type Props = {
  revision: string;
  visible: boolean;
  children?: Snippet;
};

let { revision, visible, children }: Props = $props();

let region: HTMLDivElement | undefined = $state();
let content: HTMLDivElement | undefined = $state();
let motion: ToolActivityMotionController | undefined;
let previousRevision: string | undefined;
let capturedHeight: number | undefined;

function ensureMotion(): ToolActivityMotionController | undefined {
  if (!motion && region && content) {
    motion = createToolActivityMotion(region, content);
  }
  return motion;
}

// Capture the outgoing visual height before a structural DOM update. During an
// interrupted animation getBoundingClientRect() returns the current frame.
$effect.pre(() => {
  const nextRevision = revision;
  if (previousRevision === undefined) {
    previousRevision = nextRevision;
    return;
  }
  if (nextRevision === previousRevision) return;
  capturedHeight = region?.getBoundingClientRect().height;
  previousRevision = nextRevision;
});

// Effects run after Svelte has applied the new body/footer structure, so the
// controller can measure the latest intrinsic inner height.
$effect(() => {
  void revision;
  if (capturedHeight === undefined) return;
  const fromHeight = capturedHeight;
  capturedHeight = undefined;
  ensureMotion()?.transition(fromHeight, prefersReducedMotion.current);
});

$effect(() => {
  if (prefersReducedMotion.current) motion?.snap();
});

$effect(() => () => motion?.destroy());
</script>

<div bind:this={region} class="min-w-0">
  <div
    bind:this={content}
    class={`grid min-w-0 gap-1.5${visible ? " pt-1.5" : ""}`}
  >
    {#if children}{@render children()}{/if}
  </div>
</div>
