<script lang="ts">
import { cn, type WithElementRef } from "@nervekit/ui-kit/utils";
import type { HTMLAttributes } from "svelte/elements";

let {
  ref = $bindable(null),
  class: className,
  children,
  ...restProps
}: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<div
  bind:this={ref}
  data-slot="empty-description"
  class={cn(
    "text-ui/relaxed text-muted-foreground [&>a:hover]:text-primary text-ui/relaxed [&>a]:underline [&>a]:underline-offset-4",
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</div>
