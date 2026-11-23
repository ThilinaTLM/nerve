<!--
@component
Shared delay settings of the tooltips inside it; wrap them once.
-->

<script lang="ts">
import { Tooltip as TooltipPrimitive } from "bits-ui";

let { delayDuration = 0, ...restProps }: TooltipPrimitive.ProviderProps =
  $props();
</script>

<TooltipPrimitive.Provider {delayDuration} {...restProps} />
