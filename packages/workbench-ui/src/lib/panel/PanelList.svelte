<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/core/utils";

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
  aria-label={role === "list" ? ariaLabel : undefined}
  class={cn("flex min-w-0 flex-col py-0.5", className)}
>
  {@render children()}
</div>
