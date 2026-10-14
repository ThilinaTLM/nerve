<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/utils";

let {
  ariaLabel,
  class: className,
  children,
}: {
  ariaLabel?: string;
  class?: string;
  children: Snippet;
} = $props();
</script>

<div
  role={ariaLabel ? "list" : undefined}
  aria-label={ariaLabel}
  class={cn(
    "divide-y divide-border overflow-hidden rounded-md border bg-card",
    className,
  )}
>
  {@render children()}
</div>
