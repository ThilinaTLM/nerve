<script lang="ts">
// A slot reserved before its value is known: a skeleton bar sized like one
// line of the value, then the value fades in at the same position. The
// skeleton is removed immediately (never cross-faded with the value).
import { fade } from "svelte/transition";
import { prefersReducedMotion } from "svelte/motion";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import { StreamingText } from "@nervekit/ui-kit/components/composites/streaming-text";
import { cn } from "@nervekit/ui-kit/utils";

type Props = {
  text?: string;
  /** Skeleton bar width utility, e.g. `w-24`. */
  width?: string;
  streaming?: boolean;
  class?: string;
};
let {
  text,
  width = "w-24",
  streaming = false,
  class: className,
}: Props = $props();
</script>

<span class={cn("min-w-0", className)}>
  {#if text === undefined || text === ""}
    <span class="inline-flex h-[1lh] max-w-full items-center align-bottom">
      <Skeleton class={cn("h-[0.7em] rounded-sm bg-foreground/10", width)} />
    </span>
  {:else}
    <span
      class="wrap-anywhere"
      in:fade={{ duration: prefersReducedMotion.current ? 0 : 220 }}
      ><StreamingText {text} fade={streaming} /></span
    >
  {/if}
</span>
