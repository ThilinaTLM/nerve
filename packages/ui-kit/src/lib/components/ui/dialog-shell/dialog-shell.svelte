<script lang="ts">
import type { Snippet } from "svelte";
import { Dialog as DialogPrimitive } from "bits-ui";
import X from "@lucide/svelte/icons/x";
import { cn } from "@nervekit/ui-kit/core/utils";

type Props = {
  children?: Snippet;
  footer?: Snippet;
  headerActions?: Snippet;
  open?: boolean;
  title?: string;
  description?: string;
  class?: string;
  closeLabel?: string;
  size?: "sm" | "default" | "wide" | "viewport";
  /** Removes the default body padding for edge-to-edge list/graph content. */
  flush?: boolean;
  onOpenChange?: (open: boolean) => void;
};

let {
  children,
  footer,
  headerActions,
  open = $bindable(false),
  title = "Dialog",
  description,
  class: className = "",
  closeLabel = "Close dialog",
  size = "default",
  flush = false,
  onOpenChange,
}: Props = $props();

function handleOpenChange(next: boolean) {
  open = next;
  onOpenChange?.(next);
}
</script>

<DialogPrimitive.Root bind:open onOpenChange={handleOpenChange}>
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay
      class="dialog-overlay data-open:animate-in data-closed:animate-out data-open:fade-in-0 data-closed:fade-out-0 duration-100"
    />
    <DialogPrimitive.Content
      class={cn(
        "dialog-content data-open:animate-in data-closed:animate-out data-open:fade-in-0 data-closed:fade-out-0 data-open:zoom-in-95 data-closed:zoom-out-95 duration-100 outline-none",
        size === "sm" && "dialog-content-sm",
        size === "wide" && "dialog-content-wide",
        size === "viewport" && "dialog-content-viewport",
        className,
      )}
    >
      <header class="dialog-header">
        <div class="dialog-title-block">
          <DialogPrimitive.Title class="dialog-title"
            >{title}</DialogPrimitive.Title
          >
          {#if description}
            <DialogPrimitive.Description class="dialog-description"
              >{description}</DialogPrimitive.Description
            >
          {/if}
        </div>
        {#if headerActions}
          <div class="dialog-header-actions">
            {@render headerActions()}
          </div>
        {/if}
        <DialogPrimitive.Close class="dialog-close" aria-label={closeLabel}>
          <X size={14} strokeWidth={2.25} aria-hidden="true" />
        </DialogPrimitive.Close>
      </header>
      <div class={cn("dialog-body", flush && "dialog-body-flush")}>
        {@render children?.()}
      </div>
      {#if footer}
        <footer class="dialog-footer">
          {@render footer()}
        </footer>
      {/if}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
</DialogPrimitive.Root>
