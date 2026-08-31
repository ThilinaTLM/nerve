<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/utils";

let {
  dense = false,
  class: className,
  children,
}: {
  dense?: boolean;
  class?: string;
  children: Snippet;
} = $props();
</script>

<div
  class={cn(
    "flex min-w-0 shrink-0 items-center gap-1.5 overflow-hidden border-b bg-card",
    dense ? "h-7" : "h-8",
    className,
  )}
>
  {@render children()}
</div>
