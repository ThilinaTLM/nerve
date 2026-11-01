<script lang="ts">
import { untrack } from "svelte";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import SelectField from "@nervekit/ui-kit/components/composites/select-field";
import type { LaunchFolderOption } from "./launch-tree.js";

const ROOT = "__root__";

let {
  open = $bindable(false),
  mode,
  initialLabel = "",
  parentFolderId = null,
  folders = [],
  existingLabels = [],
  saving = false,
  onSave,
  onOpenChange,
}: {
  open?: boolean;
  mode: "create" | "rename";
  initialLabel?: string;
  parentFolderId?: string | null;
  /** Destination choices for create mode. */
  folders?: readonly LaunchFolderOption[];
  /** Sibling names (excluding the folder being renamed) for early feedback. */
  existingLabels?: readonly string[];
  saving?: boolean;
  onSave?: (label: string, parentFolderId: string | null) => void;
  onOpenChange?: (open: boolean) => void;
} = $props();

let label = $state(untrack(() => initialLabel));
let parent = $state(untrack(() => parentFolderId ?? ROOT));

const trimmed = $derived(label.trim());
const siblingLabels = $derived(
  mode === "create" ? [] : existingLabels.map((name) => name.toLowerCase()),
);
// Same key the server uses: trimmed, lower-cased.
const duplicate = $derived(
  mode === "rename" && siblingLabels.includes(trimmed.toLowerCase()),
);
const canSave = $derived(!saving && trimmed.length > 0 && !duplicate);

function submit() {
  if (!canSave) return;
  onSave?.(trimmed, parent === ROOT ? null : parent);
}
</script>

<Dialog
  bind:open
  title={mode === "create" ? "New folder" : "Rename folder"}
  description={mode === "create"
    ? "Group launch configurations. Folders only organize; they never run."
    : "Folder names must be unique within their parent."}
  size="sm"
  {onOpenChange}
>
  <form
    class="grid gap-3"
    onsubmit={(event) => {
      event.preventDefault();
      submit();
    }}
  >
    <div class="grid gap-1.5">
      <Label for="launch-folder-label">Name</Label>
      <Input
        id="launch-folder-label"
        bind:value={label}
        placeholder="Services"
        disabled={saving}
        aria-invalid={duplicate}
        autofocus
      />
      {#if duplicate}
        <p class="text-ui text-destructive">
          A folder with this name already exists here.
        </p>
      {/if}
    </div>
    {#if mode === "create"}
      <div class="grid gap-1.5">
        <Label for="launch-folder-parent">Location</Label>
        <SelectField
          bind:value={parent}
          ariaLabel="Folder location"
          items={[
            { value: ROOT, label: "Top level" },
            ...folders.map((folder) => ({
              value: folder.id,
              label: folder.label,
            })),
          ]}
          disabled={saving}
        />
      </div>
    {/if}
    <button type="submit" class="hidden" tabindex="-1" aria-hidden="true"
    ></button>
  </form>

  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)} disabled={saving}
      >Cancel</Button
    >
    <Button onclick={submit} disabled={!canSave}
      >{saving
        ? "Saving…"
        : mode === "create"
          ? "Create folder"
          : "Rename"}</Button
    >
  {/snippet}
</Dialog>
