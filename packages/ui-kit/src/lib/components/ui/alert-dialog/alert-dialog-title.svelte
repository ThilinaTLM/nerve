<script lang="ts">
import { AlertDialog as AlertDialogPrimitive } from "bits-ui";
import { cn } from "@nervekit/ui-kit/core/utils";

let {
  ref = $bindable(null),
  class: className,
  ...restProps
}: AlertDialogPrimitive.TitleProps = $props();
</script>

<AlertDialogPrimitive.Title
  bind:ref
  data-slot="alert-dialog-title"
  class={cn("dialog-title", className)}
  {...restProps}
/>
