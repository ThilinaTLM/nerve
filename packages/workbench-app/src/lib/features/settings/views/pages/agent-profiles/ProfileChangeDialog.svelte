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
  takenTools?: string[];
  context: ProfileEditContext;
  onSave: (change: ChangeDraft) => void;
};
let {
  open = $bindable(false),
  profileLabel,
  usableBy,
  change,
  editing = false,
  takenTools = [],
  context,
  onSave,
}: Props = $props();

let draft = $state<ChangeDraft>({
  key: "model",
  mode: "set",
  value: undefined,
});
let valid = $state(true);
let lastOpen = false;
$effect(() => {
  if (open && !lastOpen) draft = structuredClone($state.snapshot(change));
  lastOpen = open;
});
function save(): void {
  if (!valid || draft.key === "tool:") return;
  onSave($state.snapshot(draft));
  open = false;
}
</script>

<Dialog
  bind:open
  size="sm"
  title={`${editing ? "Change" : "Add"} ${changeLabel(change.key).toLowerCase()} · ${profileLabel}`}
  description="Profiles are templates. This applies the next time the profile is used."
>
  <ProfileChangeForm
    bind:draft
    {usableBy}
    {context}
    {takenTools}
    fixedTool={editing}
    bind:valid
  />
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
    <Button onclick={save} disabled={!valid || draft.key === "tool:"}
      >{editing ? "Save change" : "Add change"}</Button
    >
  {/snippet}
</Dialog>
