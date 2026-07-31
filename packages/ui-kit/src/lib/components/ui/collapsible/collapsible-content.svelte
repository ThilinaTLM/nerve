<script lang="ts">
import { Collapsible as CollapsiblePrimitive } from "bits-ui";
import { cn } from "@nervekit/ui-kit/core/utils";

let {
  ref = $bindable(null),
  class: className,
  ...restProps
}: CollapsiblePrimitive.ContentProps = $props();
</script>

<CollapsiblePrimitive.Content
  bind:ref
  data-slot="collapsible-content"
  class={cn(
    "overflow-hidden outline-none data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up",
    className,
  )}
  {...restProps}
/>
