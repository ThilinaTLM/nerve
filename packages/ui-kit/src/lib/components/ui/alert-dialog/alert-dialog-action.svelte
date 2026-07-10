<script lang="ts">
import { AlertDialog as AlertDialogPrimitive } from "bits-ui";
import {
  buttonVariants,
  type ButtonVariant,
  type ButtonSize,
} from "@nervekit/ui-kit/components/ui/button";
import { cn } from "@nervekit/ui-kit/core/utils";

let {
  ref = $bindable(null),
  class: className,
  variant = "default",
  size = "default",
  ...restProps
}: AlertDialogPrimitive.ActionProps & {
  variant?: ButtonVariant;
  size?: ButtonSize;
} = $props();
</script>

<AlertDialogPrimitive.Action
  bind:ref
  data-slot="alert-dialog-action"
  class={cn(
    buttonVariants({ variant, size }),
    "cn-alert-dialog-action",
    className,
  )}
  {...restProps}
/>
