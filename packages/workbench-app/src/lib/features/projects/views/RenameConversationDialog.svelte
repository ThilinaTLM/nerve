<script lang="ts">
import FormDialog from "@nervekit/ui-kit/components/composites/form-dialog";
import RenameConversationForm from "./RenameConversationForm.svelte";

/** Rename for touch layouts; desktop uses `RenameConversationPopover`. */
let {
  open = $bindable(false),
  title,
  onRename,
  onOpenChange,
}: {
  open?: boolean;
  title: string;
  onRename: (title: string) => void;
  onOpenChange?: (open: boolean) => void;
} = $props();

let value = $state("");
let canSave = $state(false);

function submit() {
  if (!canSave) return;
  onRename(value);
  open = false;
  onOpenChange?.(false);
}
</script>

<FormDialog
  bind:open
  title="Rename conversation"
  size="sm"
  submitLabel="Rename"
  submitDisabled={!canSave}
  onSubmit={submit}
  {onOpenChange}
>
  <RenameConversationForm {title} bind:value bind:canSave onSubmit={submit} />
</FormDialog>
