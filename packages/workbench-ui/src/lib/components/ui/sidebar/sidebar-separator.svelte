<script lang="ts">
import { Separator } from "@nervekit/workbench-ui/components/ui/separator";
import { cn } from "@nervekit/workbench-ui/core/utils";
import type { ComponentProps } from "svelte";

let {
  ref = $bindable(null),
  class: className,
  ...restProps
}: ComponentProps<typeof Separator> = $props();
</script>

<Separator
  bind:ref
  data-slot="sidebar-separator"
  data-sidebar="separator"
  class={cn("bg-sidebar-border", className)}
  {...restProps}
/>
