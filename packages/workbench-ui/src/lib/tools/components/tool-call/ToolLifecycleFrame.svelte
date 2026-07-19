<script lang="ts">
import type { Snippet } from "svelte";
import { prefersReducedMotion } from "svelte/motion";
import { getConversationMotionBudget } from "../../../components/transcript/conversation-motion-context.svelte";
import {
  createToolLifecycleMotion,
  type ToolLifecycleMotionController,
} from "./tool-lifecycle-motion";

type Props = {
  revision: string;
  children?: Snippet;
};

let { revision, children }: Props = $props();

const motionBudget = getConversationMotionBudget();
let region: HTMLDivElement | undefined = $state();
let content: HTMLDivElement | undefined = $state();
let motion: ToolLifecycleMotionController | undefined;
let previousRevision: string | undefined;
let capturedHeight: number | undefined;

function ensureMotion(): ToolLifecycleMotionController | undefined {
  if (!motion && region && content) {
    motion = createToolLifecycleMotion(region, content);
  }
  return motion;
}

// Capture the currently displayed height before Svelte commits a lifecycle
// milestone. During interruption this is the in-progress visual height.
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

$effect(() => {
  void revision;
  if (capturedHeight === undefined) return;
  const fromHeight = capturedHeight;
  capturedHeight = undefined;
  const reducedMotion = prefersReducedMotion.current;
  const visible = Boolean(region?.getClientRects().length);
  const profile =
    !reducedMotion && visible
      ? (motionBudget?.claim() ?? "standard")
      : "standard";
  ensureMotion()?.transition(fromHeight, reducedMotion, profile);
});

$effect(() => {
  if (prefersReducedMotion.current) motion?.snap();
});

$effect(() => () => motion?.destroy());
</script>

<div bind:this={region} class="min-w-0">
  <div bind:this={content} class="min-w-0">
    {#if children}{@render children()}{/if}
  </div>
</div>
