<!--
  Edits one change of a profile in a dialog: the same editor the change rows
  open, with Remove. Instructions save when their field loses focus.
-->
<script lang="ts">
import type { ProfileUsableBy } from "@nervekit/contracts/agent-configuration";
import DialogShell from "@nervekit/ui-kit/components/composites/dialog-shell";
import ProfileChangeEditor from "./ProfileChangeEditor.svelte";
import type { ChangeDraft, ProfileEditContext } from "./profile-edit-context";

let {
  open = $bindable(false),
  change,
  title,
  context,
  usableBy,
  onSave,
}: {
  open?: boolean;
  change?: ChangeDraft;
  title: string;
  context: ProfileEditContext;
  usableBy: ProfileUsableBy;
  onSave: (change: ChangeDraft) => Promise<void>;
} = $props();
</script>

<DialogShell bind:open {title} size="md" flush>
  {#if open && change}
    {#key change.key}
      <ProfileChangeEditor
        {title}
        {change}
        {context}
        {usableBy}
        {onSave}
        onRemove={() => (open = false)}
      />
    {/key}
  {/if}
</DialogShell>
