<script lang="ts">
  import type { Snippet } from "svelte";
  import { Dialog as DialogPrimitive } from "bits-ui";
  import X from "lucide-svelte/icons/x";
  import { cn } from "../../utils/cn";

  type Props = {
    children?: Snippet;
    footer?: Snippet;
    open?: boolean;
    title?: string;
    description?: string;
    class?: string;
    closeLabel?: string;
    onOpenChange?: (open: boolean) => void;
  };

  let {
    children,
    footer,
    open = $bindable(false),
    title = "Dialog",
    description,
    class: className = "",
    closeLabel = "Close dialog",
    onOpenChange,
  }: Props = $props();

  function handleOpenChange(next: boolean) {
    open = next;
    onOpenChange?.(next);
  }
</script>

<DialogPrimitive.Root bind:open onOpenChange={handleOpenChange}>
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay class="dialog-overlay" />
    <DialogPrimitive.Content class={cn("dialog-content", className)}>
      <header class="dialog-header">
        <div class="dialog-title-block">
          <DialogPrimitive.Title class="dialog-title">{title}</DialogPrimitive.Title>
          {#if description}
            <DialogPrimitive.Description class="dialog-description">{description}</DialogPrimitive.Description>
          {/if}
        </div>
        <DialogPrimitive.Close class="dialog-close" aria-label={closeLabel}>
          <X size={15} strokeWidth={2.25} aria-hidden="true" />
        </DialogPrimitive.Close>
      </header>
      <div class="dialog-body">
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

<style>
  :global(.dialog-overlay) {
    position: fixed;
    z-index: 50;
    inset: 0;
    background: rgb(0 0 0 / 56%);
    backdrop-filter: blur(2px);
  }

  :global(.dialog-content) {
    position: fixed;
    z-index: 51;
    top: 8vh;
    left: 50%;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    width: min(760px, calc(100vw - 32px));
    max-height: 82vh;
    transform: translateX(-50%);
    overflow: hidden;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-panel);
    color: var(--color-text);
    box-shadow: var(--shadow-dialog);
  }

  .dialog-header,
  .dialog-footer {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    border-bottom: 1px solid var(--color-border-subtle);
    background: var(--color-panel-muted);
    padding: 0.62rem 0.72rem;
  }

  .dialog-header {
    justify-content: space-between;
  }

  .dialog-footer {
    justify-content: flex-end;
    border-top: 1px solid var(--color-border-subtle);
    border-bottom: 0;
  }

  .dialog-title-block {
    display: grid;
    min-width: 0;
    gap: 0.12rem;
  }

  :global(.dialog-title) {
    margin: 0;
    color: var(--color-text);
    font-size: 0.86rem;
    font-weight: 700;
  }

  :global(.dialog-description) {
    margin: 0;
    color: var(--color-muted);
    font-size: 0.74rem;
  }

  :global(.dialog-close) {
    display: inline-grid;
    flex: none;
    width: var(--control-height-sm);
    height: var(--control-height-sm);
    place-items: center;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-field);
    color: var(--color-muted);
    cursor: pointer;
  }

  :global(.dialog-close:hover) {
    background: var(--color-panel-raised);
    color: var(--color-text);
  }

  .dialog-body {
    min-height: 0;
    overflow: auto;
  }
</style>
