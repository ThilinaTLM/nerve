<script lang="ts">
import { Dialog as DialogPrimitive } from "bits-ui";
import { cn } from "@nervekit/ui-kit/core/utils";

let {
  ref = $bindable(null),
  class: className,
  ...restProps
}: DialogPrimitive.TitleProps = $props();
</script>

<DialogPrimitive.Title
  bind:ref
  data-slot="sheet-title"
  class={cn("text-foreground font-medium", className)}
  {...restProps}
/>
