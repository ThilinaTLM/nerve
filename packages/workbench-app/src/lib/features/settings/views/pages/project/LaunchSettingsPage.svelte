<!--
  Launch definitions of this project (`.nerve/launches/definitions.json`).
  Opening a row edits it; New launch is the page's header action. Data and
  actions come from the launches feature through the host.
-->
<script lang="ts">
import Play from "@lucide/svelte/icons/play";
import Plus from "@lucide/svelte/icons/plus";
import Trash2 from "@lucide/svelte/icons/trash-2";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import IconAction from "@nervekit/ui-kit/components/composites/icon-action";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import {
  SettingsEmptyState,
  SettingsItem,
  SettingsList,
  SettingsSection,
  TipBadge,
} from "$lib/presentation/settings";

export type LaunchDefinitionRow = {
  id: string;
  label: string;
  command: string;
  cwd?: string;
  port?: number;
  runPolicy: "single" | "concurrent";
};

type Props = {
  definitions: LaunchDefinitionRow[];
  onAdd?: () => void;
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => void;
};
let { definitions, onAdd, onEdit, onDelete }: Props = $props();
let deleting = $state<LaunchDefinitionRow>();
</script>

<SettingsSection id="launch" surface={false}>
  {#if definitions.length === 0}
    <SettingsEmptyState
      variant="card"
      icon={Play}
      title="No launch definitions yet."
    >
      {#snippet actions()}
        {#if onAdd}
          <Button size="sm" variant="outline" onclick={onAdd}
            ><Plus class="size-3.5" aria-hidden="true" />New launch</Button
          >
        {/if}
      {/snippet}
    </SettingsEmptyState>
  {:else}
    <SettingsList ariaLabel="Launch definitions">
      {#each definitions as definition (definition.id)}
        <SettingsItem
          title={definition.label}
          icon={Play}
          summary={[definition.command, definition.cwd]
            .filter(Boolean)
            .join(" · ")}
          mono
          onOpen={onEdit ? () => onEdit?.(definition.id) : undefined}
          openLabel={`Edit ${definition.label}`}
        >
          {#snippet badges()}
            {#if definition.runPolicy === "concurrent"}
              <TipBadge
                text="Concurrent"
                tip="Starting it again runs another process instead of focusing the running one."
              />
            {/if}
          {/snippet}
          {#snippet meta()}
            {#if definition.port}
              <span class="text-caption text-muted-foreground"
                >Port {definition.port}</span
              >
            {/if}
          {/snippet}
          {#snippet actions()}
            {#if onDelete}
              <IconAction
                icon={Trash2}
                label={`Delete ${definition.label}`}
                tone="destructive"
                onclick={() => (deleting = definition)}
              />
            {/if}
          {/snippet}
        </SettingsItem>
      {/each}
    </SettingsList>
  {/if}
</SettingsSection>

<ConfirmDialog
  open={!!deleting}
  onOpenChange={(open) => {
    if (!open) deleting = undefined;
  }}
  title={`Delete ${deleting?.label ?? "launch"}?`}
  description="Removes it from .nerve/launches/definitions.json. Runs already started keep going."
  confirmLabel="Delete"
  destructive
  onConfirm={() => {
    if (deleting) onDelete?.(deleting.id);
    deleting = undefined;
  }}
/>
