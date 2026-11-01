<!--
  Launch definitions of this project, listed for reference and editing from
  settings. Data and actions come from the launches feature through the host.
-->
<script lang="ts">
import Pencil from "@lucide/svelte/icons/pencil";
import Plus from "@lucide/svelte/icons/plus";
import Trash2 from "@lucide/svelte/icons/trash-2";
import IconAction from "@nervekit/ui-kit/components/composites/icon-action";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import {
  SettingsEmptyState,
  SettingsRow,
  SettingsSection,
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
</script>

<SettingsSection id="launch" divided>
  {#snippet actions()}
    {#if onAdd}
      <Button size="sm" variant="outline" onclick={onAdd}
        ><Plus class="size-3" aria-hidden="true" />New launch</Button
      >
    {/if}
  {/snippet}
  {#each definitions as definition (definition.id)}
    <SettingsRow
      label={definition.label}
      description={[
        definition.command,
        definition.cwd,
        definition.port ? `port ${definition.port}` : undefined,
      ]
        .filter(Boolean)
        .join(" · ")}
    >
      {#snippet badges()}
        {#if definition.runPolicy === "concurrent"}<Badge variant="neutral"
            >Concurrent</Badge
          >{/if}
      {/snippet}
      {#snippet control()}
        {#if onEdit}<IconAction
            icon={Pencil}
            label={`Edit ${definition.label}`}
            onclick={() => onEdit?.(definition.id)}
          />{/if}
        {#if onDelete}<IconAction
            icon={Trash2}
            label={`Delete ${definition.label}`}
            tone="destructive"
            onclick={() => onDelete?.(definition.id)}
          />{/if}
      {/snippet}
    </SettingsRow>
  {:else}
    <SettingsEmptyState
      variant="card"
      title="No launch definitions"
      description="Add a dev server or command to start it from the toolbar."
    />
  {/each}
</SettingsSection>
