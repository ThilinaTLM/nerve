<script lang="ts">
  import type { Snippet } from "svelte";
  import { Dialog as DialogPrimitive } from "bits-ui";
  import X from "@lucide/svelte/icons/x";
  import { cn } from "$lib/core/utils.js";

  type Props = {
    children?: Snippet;
    footer?: Snippet;
    headerActions?: Snippet;
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
    headerActions,
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
        {#if headerActions}
          <div class="dialog-header-actions">
            {@render headerActions()}
          </div>
        {/if}
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
    background: color-mix(in oklab, var(--sidebar) 72%, transparent);
  }

  :global(.dialog-content) {
    position: fixed;
    z-index: 50;
    top: 7vh;
    left: 50%;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    width: min(760px, calc(100vw - 32px));
    max-height: 84vh;
    transform: translateX(-50%);
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--card);
    color: var(--foreground);
    box-shadow: var(--shadow-xl);
  }

  .dialog-header,
  .dialog-footer {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    background: var(--accent);
    padding: 0.75rem 0.875rem;
  }

  .dialog-header {
    justify-content: space-between;
    border-bottom: 1px solid var(--border);
  }

  .dialog-header-actions {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 0.4rem;
  }

  .dialog-footer {
    justify-content: flex-end;
    border-top: 1px solid var(--border);
  }

  .dialog-title-block {
    display: grid;
    min-width: min(16rem, 40%);
    gap: 0.16rem;
  }

  :global(.dialog-title) {
    margin: 0;
    color: var(--foreground);
    font-size: var(--text-base);
    font-weight: 600;
    line-height: 1.18;
  }

  :global(.dialog-description) {
    margin: 0;
    color: var(--muted-foreground);
    font-size: var(--text-xs);
  }

  :global(.dialog-close) {
    display: inline-grid;
    flex: none;
    width: 1.75rem;
    height: 1.75rem;
    place-items: center;
    border: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
    border-radius: var(--radius-sm);
    background: var(--input);
    color: var(--muted-foreground);
    cursor: pointer;
  }

  :global(.dialog-close:hover) {
    border-color: var(--border);
    background: var(--card);
    color: var(--foreground);
  }

  :global(.dialog-close:focus-visible) {
    border-color: var(--ring);
    outline: none;
    box-shadow: 0 0 0 3px color-mix(in oklab, var(--ring) 28%, transparent);
  }

  .dialog-body {
    min-height: 0;
    overflow: auto;
    background: var(--card);
  }
</style>
