<script lang="ts">
import { Dialog as DialogPrimitive } from "bits-ui";
import type { ComponentProps, Snippet } from "svelte";
import SheetOverlay from "./sheet-overlay.svelte";
import SheetPortal from "./sheet-portal.svelte";
import {
  cn,
  type WithoutChildrenOrChild,
} from "@nervekit/workbench-ui/core/utils";

let {
  ref = $bindable(null),
  class: className,
  side = "right",
  portalProps,
  children,
  ...restProps
}: WithoutChildrenOrChild<DialogPrimitive.ContentProps> & {
  portalProps?: WithoutChildrenOrChild<ComponentProps<typeof SheetPortal>>;
  side?: "top" | "right" | "bottom" | "left";
  children: Snippet;
} = $props();
</script>

<SheetPortal {...portalProps}>
  <SheetOverlay />
  <DialogPrimitive.Content
    bind:ref
    data-slot="sheet-content"
    data-side={side}
    class={cn(
      "bg-sidebar text-foreground data-open:animate-in data-closed:animate-out fixed z-50 flex flex-col overflow-hidden shadow-lg outline-none duration-200",
      side === "right" &&
        "data-open:slide-in-from-right data-closed:slide-out-to-right inset-y-0 right-0 h-full w-[min(90vw,24rem)] border-l",
      side === "left" &&
        "data-open:slide-in-from-left data-closed:slide-out-to-left inset-y-0 left-0 h-full w-[min(85vw,20rem)] border-r",
      side === "top" &&
        "data-open:slide-in-from-top data-closed:slide-out-to-top inset-x-0 top-0 h-auto max-h-[85vh] border-b",
      side === "bottom" &&
        "data-open:slide-in-from-bottom data-closed:slide-out-to-bottom inset-x-0 bottom-0 h-auto max-h-[85vh] border-t",
      className,
    )}
    {...restProps}
  >
    {@render children?.()}
  </DialogPrimitive.Content>
</SheetPortal>
