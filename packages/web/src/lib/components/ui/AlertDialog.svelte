<script lang="ts">
  import { AlertDialog } from "bits-ui";
  import { cn } from "../../utils/cn";

  type Props = {
    open?: boolean;
    title: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    destructive?: boolean;
    class?: string;
    onConfirm?: () => void;
    onCancel?: () => void;
    onOpenChange?: (open: boolean) => void;
  };

  let {
    open = $bindable(false),
    title,
    description,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    destructive = false,
    class: className = "",
    onConfirm,
    onCancel,
    onOpenChange,
  }: Props = $props();

  function handleOpenChange(next: boolean) {
    open = next;
    onOpenChange?.(next);
  }

  function handleConfirm() {
    // AlertDialog.Action does not auto-close; close manually after the action.
    onConfirm?.();
    open = false;
    onOpenChange?.(false);
  }

  function handleCancel() {
    onCancel?.();
  }
</script>

<AlertDialog.Root bind:open onOpenChange={handleOpenChange}>
  <AlertDialog.Portal>
    <AlertDialog.Overlay class="fixed inset-0 z-50 bg-black/60" />
    <AlertDialog.Content
      class={cn(
        "fixed left-1/2 top-1/2 z-50 grid w-full max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border border-border bg-popover p-5 text-popover-foreground shadow-[var(--shadow-dialog)] focus:outline-none",
        className,
      )}
    >
      <div class="grid gap-1.5">
        <AlertDialog.Title class="text-base font-semibold leading-tight text-foreground">
          {title}
        </AlertDialog.Title>
        {#if description}
          <AlertDialog.Description class="text-sm leading-relaxed text-muted-foreground">
            {description}
          </AlertDialog.Description>
        {/if}
      </div>
      <div class="flex items-center justify-end gap-2">
        <AlertDialog.Cancel
          onclick={handleCancel}
          class="inline-flex h-8 items-center justify-center rounded-md border border-border bg-secondary px-3 text-sm font-medium text-secondary-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {cancelLabel}
        </AlertDialog.Cancel>
        <AlertDialog.Action
          onclick={handleConfirm}
          class={cn(
            "inline-flex h-8 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            destructive
              ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
              : "bg-primary text-primary-foreground hover:bg-primary/90",
          )}
        >
          {confirmLabel}
        </AlertDialog.Action>
      </div>
    </AlertDialog.Content>
  </AlertDialog.Portal>
</AlertDialog.Root>
