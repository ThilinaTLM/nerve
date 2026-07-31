<script lang="ts">
import type { HTMLAttributes } from "svelte/elements";
import { cn, type WithElementRef } from "@nervekit/ui-kit/core/utils";

let {
  ref = $bindable(null),
  class: className,
  children,
  ...restProps
}: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<!-- Accent header band shared with DialogShell; the inner block stacks the
     title and description. -->
<div
  bind:this={ref}
  data-slot="alert-dialog-header"
  class={cn("dialog-header", className)}
  {...restProps}
>
  <div class="dialog-title-block">
    {@render children?.()}
  </div>
</div>
