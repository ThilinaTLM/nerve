<!--
  One profile change: the label/value opens its editor; the trailing icon flips
  Recommend (open lock) ⇄ Require (lock). Instructions have no mode.
-->
<script lang="ts">
import Lock from "@lucide/svelte/icons/lock";
import LockOpen from "@lucide/svelte/icons/lock-open";
import PopoverPanel from "@nervekit/ui-kit/components/composites/popover-panel";
import IconAction from "@nervekit/ui-kit/components/composites/icon-action";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { cn } from "@nervekit/ui-kit/utils";
import type { ProfileUsableBy } from "@nervekit/contracts/agent-configuration";
import ProfileChangeEditor from "./ProfileChangeEditor.svelte";
import { modeHint, type ChangeRow } from "./profile-changes";
import type { ChangeDraft, ProfileEditContext } from "./profile-edit-context";
let {
  row,
  value,
  label,
  context,
  usableBy,
  onSave,
  onToggleMode,
  disabled = false,
}: {
  row: ChangeRow;
  value: string;
  label: string;
  context: ProfileEditContext;
  usableBy: ProfileUsableBy;
  onSave: (change: ChangeDraft) => Promise<void>;
  onToggleMode: (mode: "recommend" | "require") => Promise<void>;
  disabled?: boolean;
} = $props();
let open = $state(false);
let toggling = $state(false);
let editor = $state<ProfileChangeEditor>();
const mode = $derived(
  row.key === "instructions"
    ? undefined
    : row.mode === "require"
      ? "require"
      : "recommend",
);
function setOpen(next: boolean) {
  if (next || row.key !== "instructions") open = next;
  else
    void editor?.flush().then((ok) => {
      if (ok) open = false;
    });
}
async function toggle() {
  if (!mode || toggling) return;
  toggling = true;
  try {
    await onToggleMode(mode === "require" ? "recommend" : "require");
  } finally {
    toggling = false;
  }
}
</script>
<span
  class={cn(
    "inline-flex min-w-0 max-w-full items-center rounded-md bg-input/30 ring-1 ring-inset ring-transparent",
    mode === "recommend" && "bg-success/10 ring-success/25",
    mode === "require" && "bg-info/10 ring-info/30",
  )}
>
  <PopoverPanel
    bind:open={() => open, setOpen}
    size="lg"
    align="start"
    ariaLabel={`Edit ${label}`}
  >
    {#snippet triggerChild({ props })}
      <Button
        {...props}
        variant="ghost"
        size="sm"
        {disabled}
        class={cn("min-w-0 max-w-full", mode && "pr-0.5")}
      >
        <span class="text-muted-foreground">{label}</span><span
          class="max-w-48 truncate">{value}</span
        >
      </Button>
    {/snippet}
    {#if open}<ProfileChangeEditor
        bind:this={editor}
        title={label}
        change={{
          key: row.key,
          mode: row.mode ?? "recommend",
          value: row.value,
        }}
        {context}
        {usableBy}
        {onSave}
        onRemove={() => (open = false)}
      />{/if}
  </PopoverPanel>
  {#if mode}<IconAction
      icon={mode === "require" ? Lock : LockOpen}
      label={modeHint(mode)}
      disabled={disabled || toggling}
      busy={toggling}
      class={mode === "require"
        ? "text-info hover:text-info"
        : "text-success hover:text-success"}
      onclick={toggle}
    />{/if}
</span>
