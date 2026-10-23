<!-- Add or edit one change of a profile: subject first, then its mode. -->
<script lang="ts">
import type { AgentProfileUsableBy } from "@nervekit/contracts/agent-profiles";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";
import ProfileChangeForm from "./ProfileChangeForm.svelte";
import { changeLabel } from "./profile-changes";
import type { ChangeDraft, ProfileEditContext } from "./profile-edit-context";

type Props = {
  open?: boolean;
  profileLabel: string;
  usableBy: AgentProfileUsableBy;
  /** The change being added or edited. */
  change: ChangeDraft;
  /** Editing keeps a tool fixed. */
  editing?: boolean;
  mixed?: boolean;
  takenTools?: string[];
  context: ProfileEditContext;
  onSave: (change: ChangeDraft) => void | Promise<void>;
};
let {
  open = $bindable(false),
  profileLabel,
  usableBy,
  change,
  editing = false,
  mixed = false,
  takenTools = [],
  context,
  onSave,
}: Props = $props();

let draft = $state<ChangeDraft>({
  key: "model",
  mode: "recommend",
  value: undefined,
});
let valid = $state(true);
let lastOpen = false;
let actionError = $state<string>();
$effect(() => {
  if (open && !lastOpen) {
    draft = structuredClone($state.snapshot(change));
    actionError = undefined;
  }
  lastOpen = open;
});
let saving = $state(false);
async function save(): Promise<void> {
  if (!valid || draft.key === "tool:") return;
  if (saving) return;
  saving = true;
  actionError = undefined;
  try {
    await onSave($state.snapshot(draft));
    open = false;
  } catch (error) {
    actionError = error instanceof Error ? error.message : String(error);
  } finally {
    saving = false;
  }
}
</script>

<Dialog
  bind:open
  size="sm"
  title={`${editing ? "Change" : "Add"} ${changeLabel(change.key).toLowerCase()} · ${profileLabel}`}
  description="Changes affect future applications only. Existing conversations keep their captured profile."
>
  {#if actionError}<p role="alert" class="text-xs text-destructive">
      {actionError}
    </p>{/if}
  {#if mixed}<p class="text-xs text-muted-foreground">
      This group mixes recommendations and requirements. Saving applies the
      selected mode to all shown values.
    </p>{/if}
  <ProfileChangeForm
    bind:draft
    {usableBy}
    {context}
    {takenTools}
    fixedTool={editing}
    bind:valid
  />
  {#snippet footer()}
    <Button variant="ghost" disabled={saving} onclick={() => (open = false)}
      >Cancel</Button
    >
    <Button onclick={save} disabled={saving || !valid || draft.key === "tool:"}
      >{editing ? "Save change" : "Add change"}</Button
    >
  {/snippet}
</Dialog>
