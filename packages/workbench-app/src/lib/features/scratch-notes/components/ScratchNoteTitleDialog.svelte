<script lang="ts">
import { SCRATCH_NOTE_TITLE_MAX_LENGTH } from "@nervekit/contracts";
import { tick } from "svelte";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import Dialog from "@nervekit/ui-kit/components/ui/dialog-shell";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Label } from "@nervekit/ui-kit/components/ui/label";

type Props = {
  open?: boolean;
  title?: string;
  onSave?: (title: string) => Promise<boolean>;
  onOpenChange?: (open: boolean) => void;
};

let {
  open = $bindable(false),
  title = "",
  onSave,
  onOpenChange,
}: Props = $props();

let draft = $state("");
let saving = $state(false);
let input: HTMLInputElement | undefined = $state();
const canSave = $derived(
  !saving &&
    draft.trim().length > 0 &&
    draft.trim().length <= SCRATCH_NOTE_TITLE_MAX_LENGTH,
);

$effect(() => {
  if (!open) return;
  draft = title;
  void tick().then(() => {
    input?.focus();
    input?.select();
  });
});

function close(): void {
  open = false;
  onOpenChange?.(false);
}

async function submit(): Promise<void> {
  if (!canSave || !onSave) return;
  saving = true;
  try {
    if (await onSave(draft.trim())) close();
  } finally {
    saving = false;
  }
}
</script>

<Dialog
  bind:open
  title="Rename scratch note"
  description="Choose the title shown in the note section header."
  class="max-w-md"
  {onOpenChange}
>
  <div class="grid gap-1.5 p-4">
    <Label for="scratch-note-title">Title</Label>
    <Input
      id="scratch-note-title"
      bind:ref={input}
      bind:value={draft}
      maxlength={SCRATCH_NOTE_TITLE_MAX_LENGTH}
      disabled={saving}
      onkeydown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void submit();
        }
      }}
    />
  </div>

  {#snippet footer()}
    <Button variant="ghost" onclick={close} disabled={saving}>Cancel</Button>
    <Button onclick={() => void submit()} disabled={!canSave}
      >{saving ? "Saving…" : "Save"}</Button
    >
  {/snippet}
</Dialog>
