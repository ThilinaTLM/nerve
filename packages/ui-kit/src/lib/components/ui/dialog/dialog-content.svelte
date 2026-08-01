<script lang="ts">
import { Dialog as DialogPrimitive } from "bits-ui";
import DialogPortal from "./dialog-portal.svelte";
import type { Snippet } from "svelte";
import * as Dialog from ".";
import { cn, type WithoutChildrenOrChild } from "@nervekit/ui-kit/core/utils";
import type { ComponentProps } from "svelte";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import XIcon from "@lucide/svelte/icons/x";

let {
  ref = $bindable(null),
  class: className,
  portalProps,
  children,
  showCloseButton = true,
  layout = "default",
  ...restProps
}: WithoutChildrenOrChild<DialogPrimitive.ContentProps> & {
  portalProps?: WithoutChildrenOrChild<ComponentProps<typeof DialogPortal>>;
  children: Snippet;
  showCloseButton?: boolean;
  layout?: "default" | "shell";
} = $props();
</script>

<DialogPortal {...portalProps}>
  <Dialog.Overlay />
  <DialogPrimitive.Content
    bind:ref
    data-slot="dialog-content"
    class={cn(
      "bg-card text-foreground data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 border-border grid rounded-lg border text-sm shadow-xl duration-100 fixed top-1/2 left-1/2 z-50 w-full -translate-x-1/2 -translate-y-1/2 outline-none",
      layout === "default" && "max-w-[calc(100%-2rem)] gap-4 p-4 sm:max-w-md",
      className,
    )}
    {...restProps}
  >
    {@render children?.()}
    {#if showCloseButton}
      <DialogPrimitive.Close data-slot="dialog-close">
        {#snippet child({ props })}
          <Button
            variant="ghost"
            class="absolute top-4 right-4"
            size="icon-sm"
            {...props}
          >
            <XIcon />
            <span class="sr-only">Close</span>
          </Button>
        {/snippet}
      </DialogPrimitive.Close>
    {/if}
  </DialogPrimitive.Content>
</DialogPortal>
