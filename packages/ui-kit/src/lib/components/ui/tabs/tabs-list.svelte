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
    "group/tabs-list flex text-muted-foreground group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:w-fit group-data-[orientation=vertical]/tabs:flex-col group-data-[orientation=vertical]/tabs:gap-1 group-data-[orientation=vertical]/tabs:p-[3px]",
    /* Horizontal lists are a chrome tab strip like the editor and dock strips:
     * a full-width track a step under the content, closed by a hairline. */
    "group-data-[orientation=horizontal]/tabs:h-8 group-data-[orientation=horizontal]/tabs:w-full group-data-[orientation=horizontal]/tabs:items-stretch group-data-[orientation=horizontal]/tabs:overflow-x-auto group-data-[orientation=horizontal]/tabs:border-b group-data-[orientation=horizontal]/tabs:bg-chrome-track",
    className,
  )}
  {...restProps}
/>
