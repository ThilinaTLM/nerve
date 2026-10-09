<script lang="ts">
import { Button } from "@nervekit/ui-kit/components/ui/button";
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";
import SettingsRow from "$lib/presentation/settings/SettingsRow.svelte";
import SettingsToggleRow from "$lib/presentation/settings/SettingsToggleRow.svelte";

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
    <SettingsToggleRow
      label="Hide completed conversations"
      description="Hide conversations you marked as done."
      checked={hideCompleted}
      onCheckedChange={onHideCompletedChange}
    />
    <SettingsRow
      label="Clean up conversations"
      description="Remove conversations by age or keep only the most recent."
    >
      {#snippet control()}
        <Button
          size="sm"
          variant="outline"
          disabled={cleanUpDisabled}
          onclick={openCleanUp}
        >
          Clean up
        </Button>
      {/snippet}
    </SettingsRow>
  </div>
</Dialog>
