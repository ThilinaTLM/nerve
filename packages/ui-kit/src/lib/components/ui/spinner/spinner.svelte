<script lang="ts">
import { cn } from "@nervekit/ui-kit/utils";
import type { SVGAttributes } from "svelte/elements";

let {
  class: className,
  variant = "ring",
  role = "status",
  "aria-label": ariaLabel = "Loading",
  ...restProps
}: SVGAttributes<SVGSVGElement> & { variant?: "ring" | "refresh" } = $props();
</script>

<svg
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  {role}
  aria-label={ariaLabel}
  class={cn("spinner-ring size-4", className)}
  {...restProps}
>
  {#if variant === "refresh"}
    <path
      d="M21 12a9 9 0 0 0-15.219-6.219L3 8m0-5v5h5m-5 4a9 9 0 0 0 15.219 6.219L21 16m0 5v-5h-5"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  {:else}
    <circle
      cx="12"
      cy="12"
      r="9"
      fill="none"
      stroke-width="2"
      stroke-linecap="butt"
      pathLength="100"
      stroke-dasharray="88 12"
    />
  {/if}
</svg>
