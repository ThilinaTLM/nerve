<script lang="ts">
import { AlertDialog as AlertDialogPrimitive } from "bits-ui";
import AlertDialogPortal from "./alert-dialog-portal.svelte";
import AlertDialogOverlay from "./alert-dialog-overlay.svelte";
import {
  cn,
  type WithoutChild,
  type WithoutChildrenOrChild,
} from "@nervekit/ui-kit/core/utils";
import type { ComponentProps } from "svelte";

let {
  ref = $bindable(null),
  class: className,
  portalProps,
  ...restProps
}: WithoutChild<AlertDialogPrimitive.ContentProps> & {
  portalProps?: WithoutChildrenOrChild<
    ComponentProps<typeof AlertDialogPortal>
  >;
} = $props();
</script>

<AlertDialogPortal {...portalProps}>
  <AlertDialogOverlay />
  <AlertDialogPrimitive.Content
    bind:ref
    data-slot="alert-dialog-content"
    class={cn(
      "dialog-content dialog-content-confirm data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 duration-100 outline-none",
      className,
    )}
    {...restProps}
  />
</AlertDialogPortal>
