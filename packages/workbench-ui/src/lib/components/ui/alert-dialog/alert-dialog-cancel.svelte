<script lang="ts">
import { AlertDialog as AlertDialogPrimitive } from "bits-ui";
import {
  buttonVariants,
  type ButtonVariant,
  type ButtonSize,
} from "@nervekit/workbench-ui/components/ui/button";
import { cn } from "@nervekit/workbench-ui/core/utils";

let {
  ref = $bindable(null),
  class: className,
  variant = "outline",
  size = "default",
  ...restProps
}: AlertDialogPrimitive.CancelProps & {
  variant?: ButtonVariant;
  size?: ButtonSize;
} = $props();
</script>

<AlertDialogPrimitive.Cancel
  bind:ref
  data-slot="alert-dialog-cancel"
  class={cn(
    buttonVariants({ variant, size }),
    "cn-alert-dialog-cancel",
    className,
  )}
  {...restProps}
/>
