<script lang="ts">
import type { Snippet } from "svelte";
import { prefersReducedMotion } from "svelte/motion";
import type { ConversationMotionProfile } from "../transcript/conversation-motion-budget";
import { getConversationMotionBudget } from "../transcript/conversation-motion-context.svelte";
import {
  createLifecycleMotion,
  type LifecycleMotionController,
} from "./lifecycle-motion";

type Props = {
  revision: string;
  /** Profile claimed by the most recent milestone; `standard` before any. */
  profile?: ConversationMotionProfile;
  children?: Snippet;
};

/* eslint-disable no-useless-assignment -- $bindable defaults declare parent bindings before later reactive updates. */
let { revision, profile = $bindable("standard"), children }: Props = $props();
/* eslint-enable no-useless-assignment */

const motionBudget = getConversationMotionBudget();
let content: HTMLDivElement | undefined = $state();
let motion: LifecycleMotionController | undefined;
let previousRevision: string | undefined;

// Each lifecycle milestone settles the content in. Height is owned by the
// transcript row's follower, so nothing is measured here.
$effect(() => {
  const nextRevision = revision;
  if (previousRevision === undefined || nextRevision === previousRevision) {
    previousRevision = nextRevision;
    return;
  }
  previousRevision = nextRevision;
  if (!content) return;
  const reducedMotion = prefersReducedMotion.current;
  const claimed = reducedMotion
    ? "standard"
    : (motionBudget?.claim() ?? "standard");
  profile = claimed;
  motion ??= createLifecycleMotion(content);
  motion.transition(reducedMotion, claimed);
});

$effect(() => {
  if (prefersReducedMotion.current) motion?.snap();
});

$effect(() => () => motion?.destroy());
</script>

<div bind:this={content} class="min-w-0">
  {#if children}{@render children()}{/if}
</div>
