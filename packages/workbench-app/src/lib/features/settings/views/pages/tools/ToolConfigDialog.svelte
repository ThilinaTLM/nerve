<!-- Configure one tool at the current level, with the shared canonical form. -->
<script lang="ts">
import { canonicalSettingRequired } from "$lib/presentation/composer/capability-tool-locks";
import type { Snippet } from "svelte";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import FormDialog from "@nervekit/ui-kit/components/composites/form-dialog";
import ToolConfigForm from "./ToolConfigForm.svelte";
import { toolRow, type ToolId, type ToolPayload } from "./tool-settings";

type Props = {
  open?: boolean;
  name: ToolId;
  requiredPointers?: readonly string[];
  /** The value being edited; the dialog works on a copy until Save. */
  value: ToolPayload;
  description?: string;
  leadProfiles?: { name: string; label: string }[];
  resolvedPython?: string;
  onSave: (value: ToolPayload) => void;
  /** Above the form, e.g. the layer the change applies to. */
  header?: Snippet;
  /** Changing it while open reloads the draft from `value` (e.g. another layer). */
  source?: string;
};

let {
  open = $bindable(false),
  name,
  requiredPointers = [],
  value,
  description,
  leadProfiles,
  resolvedPython,
  onSave,
  header,
  source,
}: Props = $props();

let draft = $state<ToolPayload>({});
let valid = $state(true);
let lastOpen = false;
let lastSource: string | undefined;
$effect(() => {
  if (open && (!lastOpen || source !== lastSource))
    draft = structuredClone($state.snapshot(value));
  lastOpen = open;
  lastSource = source;
});

function save(): void {
  if (!valid) return;
  onSave($state.snapshot(draft));
  open = false;
}
</script>

<FormDialog
  bind:open
  size="sm"
  title={`Configure ${toolRow(name).label}`}
  {description}
  submitLabel="Save"
  submitDisabled={!valid}
  onSubmit={save}
>
  {#if header}{@render header()}{/if}
  <ToolConfigForm
    {name}
    {requiredPointers}
    bind:payload={draft}
    bind:valid
    {leadProfiles}
    {resolvedPython}
  />
  {#snippet footerLeading()}
    {#if name === "python_exec"}
      <Button
        variant="outline"
        disabled={canonicalSettingRequired(
          "/tools/python_exec/settings/interpreterPath",
          requiredPointers,
        )}
        onclick={() => {
          const next = {
            ...((draft.settings ?? {}) as Record<string, unknown>),
          };
          delete next.interpreterPath;
          draft = { ...draft, settings: next };
        }}>Use auto-detect</Button
      >
    {/if}
  {/snippet}
</FormDialog>
