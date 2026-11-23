<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/utils";

let {
  ariaLabel,
  role = "list",
  class: className,
  children,
}: {
  ariaLabel?: string;
  role?: "list" | "none";
  class?: string;
  children: Snippet;
} = $props();
</script>

<div
  {role}
  data-panel-list=""
  aria-label={role === "list" ? ariaLabel : undefined}
  class={cn("flex min-w-0 flex-col py-0.5", className)}
>
  {@render children()}
</div>
