<script lang="ts">
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";
import SettingsToggleRow from "$lib/presentation/settings/SettingsToggleRow.svelte";

type Props = {
  open?: boolean;
  hideCompleted?: boolean;
  onHideCompletedChange?: (enabled: boolean) => void;
  onOpenChange?: (open: boolean) => void;
};

let {
  open = $bindable(false),
  hideCompleted = false,
  onHideCompletedChange,
  onOpenChange,
}: Props = $props();
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
  </div>
</Dialog>
