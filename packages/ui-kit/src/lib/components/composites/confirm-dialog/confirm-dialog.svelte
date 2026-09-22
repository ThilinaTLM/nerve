<script lang="ts">
import * as AlertDialog from "@nervekit/ui-kit/components/ui/alert-dialog";
import { Button } from "@nervekit/ui-kit/components/ui/button";

let {
  open = $bindable(false),
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  secondaryLabel,
  destructive = false,
  confirmVariant,
  class: className,
  onConfirm,
  onSecondary,
  onCancel,
  onOpenChange,
}: {
  open?: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  secondaryLabel?: string;
  destructive?: boolean;
  /** Overrides the confirm button variant (e.g. "success"); wins over `destructive`. */
  confirmVariant?: "default" | "destructive" | "success";
  class?: string;
  onConfirm?: () => void;
  onSecondary?: () => void;
  onCancel?: () => void;
  onOpenChange?: (open: boolean) => void;
} = $props();

function close() {
  open = false;
  onOpenChange?.(false);
}

function handleConfirm() {
  onConfirm?.();
  close();
}

function handleSecondary() {
  onSecondary?.();
  close();
}

function handleCancel() {
  onCancel?.();
  close();
}
</script>

<AlertDialog.Root bind:open {onOpenChange}>
  <AlertDialog.Content class={className}>
    <AlertDialog.Header>
      <AlertDialog.Title>{title}</AlertDialog.Title>
      {#if description}
        <AlertDialog.Description class="min-w-0 [overflow-wrap:anywhere]"
          >{description}</AlertDialog.Description
        >
      {/if}
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel size="sm" onclick={handleCancel}
        >{cancelLabel}</AlertDialog.Cancel
      >
      {#if secondaryLabel}
        <Button size="sm" variant="outline" onclick={handleSecondary}>
          {secondaryLabel}
        </Button>
      {/if}
      <AlertDialog.Action
        size="sm"
        variant={confirmVariant ?? (destructive ? "destructive" : "default")}
        onclick={handleConfirm}
      >
        {confirmLabel}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
