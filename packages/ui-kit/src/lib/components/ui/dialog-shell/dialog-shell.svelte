<script lang="ts">
import type { Snippet } from "svelte";
import * as Dialog from "@nervekit/ui-kit/components/ui/dialog";
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
  size?: "sm" | "md" | "default" | "wide" | "wide-viewport" | "viewport";
  /** Removes the default body padding for edge-to-edge list/graph content. */
  flush?: boolean;
  closeOnInteractOutside?: boolean;
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
  closeOnInteractOutside = true,
  onOpenChange,
}: Props = $props();

function handleOpenChange(next: boolean) {
  open = next;
  onOpenChange?.(next);
}
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
  <Dialog.Content
    showCloseButton={false}
    layout="shell"
    onInteractOutside={(event) => {
      if (!closeOnInteractOutside) event.preventDefault();
    }}
    class={cn(
      "dialog-content data-open:animate-in data-closed:animate-out data-open:fade-in-0 data-closed:fade-out-0 data-open:zoom-in-95 data-closed:zoom-out-95 duration-100 outline-none",
      size === "sm" && "dialog-content-sm",
      size === "md" && "dialog-content-md",
      size === "wide" && "dialog-content-wide",
      size === "wide-viewport" && "dialog-content-wide-viewport",
      size === "viewport" && "dialog-content-viewport",
      className,
    )}
  >
    <header class="dialog-header">
      <div class="dialog-title-block">
        <Dialog.Title class="dialog-title">{title}</Dialog.Title>
        {#if description}
          <Dialog.Description class="dialog-description">
            {description}
          </Dialog.Description>
        {/if}
      </div>
      {#if headerActions}
        <div class="dialog-header-actions">
          {@render headerActions()}
        </div>
      {/if}
      <Dialog.Close class="dialog-close" aria-label={closeLabel}>
        <X size={14} strokeWidth={2.25} aria-hidden="true" />
      </Dialog.Close>
    </header>
    <div class={cn("dialog-body", flush && "dialog-body-flush")}>
      {@render children?.()}
    </div>
    {#if footer}
      <footer class="dialog-footer">
        {@render footer()}
      </footer>
    {/if}
  </Dialog.Content>
</Dialog.Root>
