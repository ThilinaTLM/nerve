<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/core/utils";

let {
  ariaLabel,
  divided = true,
  gap = "md",
  class: className,
  children,
}: {
  ariaLabel?: string;
  /** Render rows separated by hairlines (default) vs. spaced cards. */
  divided?: boolean;
  /** Vertical gap when `divided` is false. */
  gap?: "sm" | "md";
  class?: string;
  children: Snippet;
} = $props();
</script>

<div
  role={ariaLabel ? "list" : undefined}
  aria-label={ariaLabel}
  class={cn(
    divided
      ? "divide-y divide-border/40"
      : gap === "md"
        ? "grid gap-2"
        : "grid gap-1.5",
    className,
  )}
>
  {@render children()}
</div>
