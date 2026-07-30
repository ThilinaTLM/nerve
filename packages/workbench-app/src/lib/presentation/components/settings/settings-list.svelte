<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/core/utils";

type Props = {
  ariaLabel?: string;
  class?: string;
  children: Snippet;
};

let { ariaLabel, class: className, children }: Props = $props();
</script>

<div
  role={ariaLabel ? "list" : undefined}
  aria-label={ariaLabel}
  class={cn(
    "divide-y divide-border/60 overflow-hidden rounded-md border border-border/60",
    className,
  )}
>
  {@render children()}
</div>
