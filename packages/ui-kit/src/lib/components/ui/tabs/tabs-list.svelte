<script lang="ts">
import { Tabs as TabsPrimitive } from "bits-ui";
import { cn } from "@nervekit/ui-kit/utils";

let {
  ref = $bindable(null),
  class: className,
  ...restProps
}: TabsPrimitive.ListProps = $props();
</script>

<TabsPrimitive.List
  bind:ref
  data-slot="tabs-list"
  class={cn(
    "group/tabs-list inline-flex w-fit items-center justify-center gap-1 bg-transparent p-[3px] text-muted-foreground group-data-horizontal/tabs:h-8 group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col",
    className,
  )}
  {...restProps}
/>
