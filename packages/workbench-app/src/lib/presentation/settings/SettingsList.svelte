<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/utils";

let {
  ariaLabel,
  variant = "bordered",
  class: className,
  children,
}: {
  ariaLabel?: string;
  /**
   * `bordered` is one card surface holding hairline-separated rows. `plain` drops the
   * frame for lists that already sit inside a surface.
   */
  variant?: "bordered" | "plain";
  class?: string;
  children: Snippet;
} = $props();
</script>

<div
  role={ariaLabel ? "list" : undefined}
  aria-label={ariaLabel}
  class={cn(
    "divide-y divide-border",
    variant === "bordered" && "overflow-hidden rounded-md border bg-card",
    className,
  )}
>
  {@render children()}
</div>
