<script lang="ts">
import {
  FieldRow,
  ToggleRow,
} from "@nervekit/ui-kit/components/composites/page";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";

type Props = {
  open?: boolean;
  hideCompleted?: boolean;
  cleanUpDisabled?: boolean;
  onHideCompletedChange?: (enabled: boolean) => void;
  onCleanUp?: () => void;
  onOpenChange?: (open: boolean) => void;
};

let {
  open = $bindable(false),
  hideCompleted = false,
  cleanUpDisabled = false,
  onHideCompletedChange,
  onCleanUp,
  onOpenChange,
}: Props = $props();

function openCleanUp(): void {
  open = false;
  onOpenChange?.(false);
  onCleanUp?.();
}
</script>

<Dialog
  bind:open
  title="Conversation settings"
  description="Choose which conversations appear in the list."
  size="sm"
  {onOpenChange}
>
  <div class="grid gap-3">
    <ToggleRow
      label="Hide completed conversations"
      description="Hide conversations you marked as done."
      checked={hideCompleted}
      onCheckedChange={onHideCompletedChange}
    />
    <FieldRow
      label="Clean up conversations"
      description="Remove conversations by age or keep only the most recent."
    >
      {#snippet control()}
        <Button
          variant="outline"
          disabled={cleanUpDisabled}
          onclick={openCleanUp}
        >
          Clean up
        </Button>
      {/snippet}
    </FieldRow>
  </div>
</Dialog>
