<!--
@component
Tooltip root: wrap in `Tooltip.Provider`, then `Tooltip.Root` with a `Trigger` and a `Content`. The content flips and shifts to stay inside the window it is drawn in.
-->

<script lang="ts" generics="T = never">
import { Tooltip as TooltipPrimitive } from "bits-ui";

let { open = $bindable(false), ...restProps }: TooltipPrimitive.RootProps<T> =
  $props();
</script>

<TooltipPrimitive.Root bind:open {...restProps} />
