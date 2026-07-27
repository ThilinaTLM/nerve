<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/core/utils";

let {
  trailing = false,
  grow = false,
  class: className,
  children,
}: {
  /** Pushes the group to the end of the toolbar. */
  trailing?: boolean;
  /** Lets the group absorb the remaining toolbar width. */
  grow?: boolean;
  class?: string;
  children: Snippet;
} = $props();
</script>

<div
  class={cn(
    "flex min-w-0 items-center gap-0.5",
    trailing && "ml-auto",
    grow && "flex-1",
    className,
  )}
>
  {@render children()}
</div>
