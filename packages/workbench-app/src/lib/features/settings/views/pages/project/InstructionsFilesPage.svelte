<!--
  Prompt files read for conversations in this project: AGENTS.md (the project
  root and parent directories of the working directory) and
  .nerve/APPEND_SYSTEM.md. Nothing is read from the user folder.
-->
<script lang="ts">
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import {
  SettingsEmptyState,
  SettingsRow,
  SettingsSection,
} from "$lib/presentation/settings";

export type InstructionsFile = {
  /** Project-relative path. */
  path: string;
  kind: "agents" | "append";
  description?: string;
};

type Props = {
  files: InstructionsFile[];
  loading?: boolean;
  onOpen?: (path: string) => void;
};
let { files, loading = false, onOpen }: Props = $props();
const agents = $derived(files.filter((file) => file.kind === "agents"));
const append = $derived(files.filter((file) => file.kind === "append"));
</script>

{#snippet list(items: InstructionsFile[], emptyTitle: string)}
  {#each items as file (file.path)}
    <SettingsRow label={file.path} mono description={file.description}>
      {#snippet badges()}<Badge variant="success">Read</Badge>{/snippet}
      {#snippet control()}
        {#if onOpen}<Button
            size="sm"
            variant="outline"
            onclick={() => onOpen?.(file.path)}>Open</Button
          >{/if}
      {/snippet}
    </SettingsRow>
  {:else}
    <SettingsEmptyState
      variant="card"
      title={emptyTitle}
      description={loading
        ? "Looking for files…"
        : "Nothing found for this project."}
    />
  {/each}
{/snippet}

<SettingsSection
  id="agents-md"
  title="AGENTS.md"
  description="The project root file plus any in parent directories of the working directory."
  divided
>
  {@render list(agents, "No AGENTS.md")}
</SettingsSection>

<SettingsSection
  id="append-system"
  title="Append to system prompt"
  description="Added to the end of the system prompt."
  divided
>
  {@render list(append, "No .nerve/APPEND_SYSTEM.md")}
</SettingsSection>
