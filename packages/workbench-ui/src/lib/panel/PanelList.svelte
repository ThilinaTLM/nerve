<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/core/utils";

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
  role="list"
  aria-label={ariaLabel}
  class={cn("flex min-w-0 flex-col py-0.5", className)}
>
  {@render children()}
</div>
