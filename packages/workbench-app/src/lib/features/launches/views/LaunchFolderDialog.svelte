<script lang="ts">
import { untrack } from "svelte";
import FormDialog from "@nervekit/ui-kit/components/composites/form-dialog";
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

<FormDialog
  bind:open
  title={mode === "create" ? "New folder" : "Rename folder"}
  description={mode === "create"
    ? "Group launch configurations. Folders only organize; they never run."
    : "Folder names must be unique within their parent."}
  size="sm"
  submitLabel={mode === "create" ? "Create folder" : "Rename"}
  submitDisabled={!canSave}
  busy={saving}
  onSubmit={submit}
  {onOpenChange}
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
</FormDialog>
