<script lang="ts">
import { untrack } from "svelte";
import {
  CONVERSATION_TITLE_MAX_LENGTH,
  conversationTitleToPlainText,
} from "@nervekit/contracts/core";
import FormDialog from "@nervekit/ui-kit/components/composites/form-dialog";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Label } from "@nervekit/ui-kit/components/ui/label";

let {
  open = $bindable(false),
  title,
  onRename,
  onOpenChange,
}: {
  open?: boolean;
  /** Stored title; image markers are shown as plain text. */
  title: string;
  onRename: (title: string) => void;
  onOpenChange?: (open: boolean) => void;
} = $props();

const initial = untrack(() => conversationTitleToPlainText(title));
let value = $state(initial);
const trimmed = $derived(value.trim());
const canSave = $derived(trimmed.length > 0 && trimmed !== initial);

function submit() {
  if (!canSave) return;
  onRename(trimmed);
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
  <div class="grid gap-1.5">
    <Label for="rename-conversation-title">Title</Label>
    <Input
      id="rename-conversation-title"
      bind:value
      maxlength={CONVERSATION_TITLE_MAX_LENGTH}
      autofocus
      onfocus={(event) => event.currentTarget.select()}
    />
  </div>
</FormDialog>
