<!-- Configure one tool at the current level, with the shared canonical form. -->
<script lang="ts">
import { canonicalSettingRequired } from "$lib/presentation/composer/capability-tool-locks";
import type { ModelInfo } from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";
import ToolConfigForm from "./ToolConfigForm.svelte";
import {
  toolRow,
  type AccountOption,
  type ToolId,
  type ToolPayload,
} from "./tool-settings";

type Props = {
  open?: boolean;
  name: ToolId;
  requiredPointers?: readonly string[];
  /** The value being edited; the dialog works on a copy until Save. */
  value: ToolPayload;
  description?: string;
  models?: ModelInfo[];
  accounts?: AccountOption[];
  noAccountLabel?: string;
  leadProfiles?: { name: string; label: string }[];
  resolvedPython?: string;
  /** Goes to Integrations. Omit where accounts can't be managed (projects). */
  onManageAccounts?: () => void;
  onSave: (value: ToolPayload) => void;
};

let {
  open = $bindable(false),
  name,
  requiredPointers = [],
  value,
  description,
  models,
  accounts,
  noAccountLabel,
  leadProfiles,
  resolvedPython,
  onManageAccounts,
  onSave,
}: Props = $props();

let draft = $state<ToolPayload>({});
let valid = $state(true);
let lastOpen = false;
$effect(() => {
  if (open && !lastOpen) draft = structuredClone($state.snapshot(value));
  lastOpen = open;
});

function save(): void {
  if (!valid) return;
  onSave($state.snapshot(draft));
  open = false;
}
</script>

<Dialog
  bind:open
  size="sm"
  title={`Configure ${toolRow(name).label}`}
  {description}
>
  <ToolConfigForm
    {name}
    {requiredPointers}
    bind:payload={draft}
    bind:valid
    {models}
    {accounts}
    {noAccountLabel}
    {leadProfiles}
    {resolvedPython}
  />
  {#snippet footer()}
    {#if onManageAccounts && (name === "web_search" || name === "jira" || name === "confluence")}
      <Button variant="outline" onclick={onManageAccounts}
        >Manage accounts</Button
      >
    {/if}
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
    <Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
    <Button onclick={save} disabled={!valid}>Save</Button>
  {/snippet}
</Dialog>
