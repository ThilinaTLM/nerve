<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/utils";

/** Pinned actions or a single hint line below the body, split off by a
 * hairline. Buttons inside stretch to share the width evenly. */
let { class: className, children }: { class?: string; children?: Snippet } =
  $props();
</script>

<div
  class={cn(
    "flex flex-none items-center gap-1 border-t border-border p-1.5 text-xs [&>button]:flex-1",
    className,
  )}
>
  {@render children?.()}
</div>
