<script lang="ts">
import type { Separator as SeparatorPrimitive } from "bits-ui";
import { Separator } from "@nervekit/ui-kit/components/ui/separator";
import { cn } from "@nervekit/ui-kit/core/utils";

let {
  ref = $bindable(null),
  class: className,
  ...restProps
}: SeparatorPrimitive.RootProps = $props();
</script>

<Separator
  bind:ref
  data-slot="select-separator"
  class={cn("bg-border -mx-1 my-1 h-px pointer-events-none", className)}
  {...restProps}
/>
