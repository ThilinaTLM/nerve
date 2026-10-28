<script lang="ts">
import Lock from "@lucide/svelte/icons/lock";
import PopoverPanel from "@nervekit/ui-kit/components/composites/popover-panel";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type { ProfileUsableBy } from "@nervekit/contracts/agent-configuration";
import ProfileChangeEditor from "./ProfileChangeEditor.svelte";
import type { ChangeRow } from "./profile-changes";
import type { ChangeDraft, ProfileEditContext } from "./profile-edit-context";
let {
  row,
  value,
  label,
  context,
  usableBy,
  onSave,
  disabled = false,
}: {
  row: ChangeRow;
  value: string;
  label: string;
  context: ProfileEditContext;
  usableBy: ProfileUsableBy;
  onSave: (change: ChangeDraft) => Promise<void>;
  disabled?: boolean;
} = $props();
let open = $state(false);
let editor = $state<ProfileChangeEditor>();
function setOpen(next: boolean) {
  if (next || row.key !== "instructions") open = next;
  else
    void editor?.flush().then((ok) => {
      if (ok) open = false;
    });
}
</script>
<PopoverPanel
  bind:open={() => open, setOpen}
  size="lg"
  align="start"
  ariaLabel={`Edit ${label}`}
>
  {#snippet triggerChild({ props })}
    <Button
      {...props}
      variant="outline"
      size="sm"
      {disabled}
      class={row.mode === "require"
        ? "min-w-0 max-w-full border-info/30 bg-info/10"
        : "min-w-0 max-w-full"}
    >
      <span class="text-muted-foreground">{label}</span><span
        class="max-w-48 truncate">{value}</span
      >
      {#if row.mode === "require"}<Lock
          class="size-3 text-info"
          aria-label="Required"
        />{/if}
    </Button>
  {/snippet}
  {#if open}<ProfileChangeEditor
      bind:this={editor}
      title={label}
      change={{ key: row.key, mode: row.mode ?? "recommend", value: row.value }}
      {context}
      {usableBy}
      {onSave}
      onRemove={() => (open = false)}
    />{/if}
</PopoverPanel>
