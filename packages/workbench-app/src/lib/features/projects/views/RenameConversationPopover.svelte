<script lang="ts">
import PopoverPanel, {
  PopoverFooter,
  PopoverHeader,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import RenameConversationForm from "./RenameConversationForm.svelte";

/** Rename anchored to the conversation's row or tab. */
let {
  anchor,
  title,
  onRename,
  onClose,
}: {
  anchor: HTMLElement;
  title: string;
  onRename: (title: string) => void;
  /** Called once the panel has fully closed. */
  onClose: () => void;
} = $props();

let open = $state(true);
let value = $state("");
let canSave = $state(false);

function close() {
  open = false;
}

function submit() {
  if (!canSave) return;
  onRename(value);
  close();
}
</script>

<PopoverPanel
  bind:open
  {anchor}
  size="md"
  align="start"
  ariaLabel="Rename conversation"
  onOpenChangeComplete={(next) => {
    // Unmount only after the panel has closed and returned focus.
    if (!next) onClose();
  }}
>
  <PopoverHeader title="Rename conversation" />
  <div class="px-2 pb-2">
    <RenameConversationForm {title} bind:value bind:canSave onSubmit={submit} />
  </div>
  <PopoverFooter>
    <Button variant="ghost" size="sm" onclick={close}>Cancel</Button>
    <Button size="sm" disabled={!canSave} onclick={submit}>Rename</Button>
  </PopoverFooter>
</PopoverPanel>
