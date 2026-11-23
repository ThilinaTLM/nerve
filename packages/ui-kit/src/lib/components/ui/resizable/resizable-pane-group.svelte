<!--
@component
Resizable panes: `PaneGroup` (`direction`) containing `Pane`s (`defaultSize`) separated by `Handle`s.
-->

<script lang="ts">
import * as ResizablePrimitive from "paneforge";
import { cn } from "@nervekit/ui-kit/utils";

let {
  ref = $bindable(null),
  this: paneGroup = $bindable(),
  class: className,
  ...restProps
}: ResizablePrimitive.PaneGroupProps & {
  /** The pane group instance, bindable (`bind:this`), for `setLayout` and `getLayout`. */
  this?: ResizablePrimitive.PaneGroup;
} = $props();
</script>

<ResizablePrimitive.PaneGroup
  bind:ref
  bind:this={paneGroup}
  data-slot="resizable-pane-group"
  class={cn(
    "cn-resizable-panel-group flex h-full w-full data-[direction=vertical]:flex-col",
    className,
  )}
  {...restProps}
/>
