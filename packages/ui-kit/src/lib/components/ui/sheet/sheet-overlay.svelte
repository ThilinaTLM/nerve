<script lang="ts">
import { Dialog as DialogPrimitive } from "bits-ui";
import { cn } from "@nervekit/ui-kit/utils";

let {
  ref = $bindable(null),
  class: className,
  ...restProps
}: DialogPrimitive.OverlayProps = $props();
</script>

<DialogPrimitive.Overlay
  bind:ref
  data-slot="sheet-overlay"
  class={cn(
    "dialog-overlay data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 duration-200",
    className,
  )}
  {...restProps}
/>
