<script lang="ts">
import { Tabs as TabsPrimitive } from "bits-ui";
import { cn } from "@nervekit/ui-kit/utils";

let {
  ref = $bindable(null),
  class: className,
  ...restProps
}: TabsPrimitive.TriggerProps = $props();
</script>

<TabsPrimitive.Trigger
  bind:ref
  data-slot="tabs-trigger"
  class={cn(
    "relative inline-flex flex-none items-center gap-1.5 bg-transparent text-ui font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 data-active:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
    /* Horizontal: the editor/dock tab look. A `primary` rule on top marks the
     * active tab, which takes the content surface so it merges into the pane;
     * a hairline separates neighbours. */
    "group-data-[orientation=horizontal]/tabs:border-t-2 group-data-[orientation=horizontal]/tabs:border-r group-data-[orientation=horizontal]/tabs:border-t-transparent group-data-[orientation=horizontal]/tabs:border-r-border/45 group-data-[orientation=horizontal]/tabs:px-3 group-data-[orientation=horizontal]/tabs:not-data-active:hover:bg-hover group-data-[orientation=horizontal]/tabs:data-active:border-t-primary group-data-[orientation=horizontal]/tabs:data-active:bg-background",
    /* Vertical: a rounded row with a primary rule on its trailing edge. */
    "group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start group-data-[orientation=vertical]/tabs:rounded-md group-data-[orientation=vertical]/tabs:px-2 group-data-[orientation=vertical]/tabs:py-1 after:absolute after:bg-primary after:opacity-0 after:transition-opacity group-data-[orientation=vertical]/tabs:after:inset-y-0 group-data-[orientation=vertical]/tabs:after:-right-1 group-data-[orientation=vertical]/tabs:after:w-0.5 group-data-[orientation=vertical]/tabs:data-active:after:opacity-100",
    className,
  )}
  {...restProps}
/>
