<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/core/utils";

let {
  role = "none",
  class: className,
  children,
}: {
  /** Outer semantics; rows inside already carry `listitem` where needed. */
  role?: "listitem" | "none";
  class?: string;
  children: Snippet;
} = $props();
</script>

<div
  {role}
  class={cn(
    "panel-row-card flex min-w-0 flex-col rounded-md px-1 py-0.5 ring-1 ring-border ring-inset transition-colors",
    className,
  )}
>
  {@render children()}
</div>
