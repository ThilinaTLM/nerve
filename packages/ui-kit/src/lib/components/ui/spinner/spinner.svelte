<script lang="ts">
import { cn } from "@nervekit/ui-kit/core/utils";
import type { SVGAttributes } from "svelte/elements";

let {
  class: className,
  role = "status",
  "aria-label": ariaLabel = "Loading",
  ...restProps
}: SVGAttributes<SVGSVGElement> = $props();
</script>

<svg
  viewBox="0 0 24 24"
  fill="none"
  {role}
  aria-label={ariaLabel}
  class={cn("spinner-ring size-4", className)}
  {...restProps}
>
  <circle
    cx="12"
    cy="12"
    r="9"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="butt"
    pathLength="100"
    stroke-dasharray="88 12"
  />
</svg>
