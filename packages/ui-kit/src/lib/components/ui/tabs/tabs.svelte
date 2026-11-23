<!--
@component
Tabs root: `<Tabs.Root bind:value><Tabs.List><Tabs.Trigger value="a">…</Tabs.Trigger></Tabs.List><Tabs.Content value="a">…</Tabs.Content></Tabs.Root>`; `value` is the active tab.
-->

<script lang="ts">
import { Tabs as TabsPrimitive } from "bits-ui";
import { cn } from "@nervekit/ui-kit/utils";

let {
  ref = $bindable(null),
  value = $bindable(""),
  class: className,
  ...restProps
}: TabsPrimitive.RootProps = $props();
</script>

<TabsPrimitive.Root
  bind:ref
  bind:value
  data-slot="tabs"
  class={cn(
    "gap-2 group/tabs flex data-[orientation=horizontal]:flex-col data-[orientation=horizontal]:gap-0",
    className,
  )}
  {...restProps}
/>
