<!--
  Prompt files read for conversations in this project: AGENTS.md (the project
  root and parent directories of the working directory) and
  .nerve/APPEND_SYSTEM.md. Nothing is read from the user folder.
-->
<script lang="ts">
import FileText from "@lucide/svelte/icons/file-text";
import {
  SettingsEmptyState,
  SettingsItem,
  SettingsList,
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

{#snippet list(
  items: InstructionsFile[],
  emptyTitle: string,
  emptyHint: string,
)}
  {#if items.length === 0}
    <SettingsEmptyState
      variant="card"
      icon={FileText}
      title={emptyTitle}
      description={loading ? "Looking for files…" : emptyHint}
    />
  {:else}
    <SettingsList>
      {#each items as file (file.path)}
        <SettingsItem
          title={file.path}
          icon={FileText}
          summary={file.description}
          onOpen={onOpen ? () => onOpen?.(file.path) : undefined}
          openLabel={`Open ${file.path}`}
        />
      {/each}
    </SettingsList>
  {/if}
{/snippet}

<SettingsSection
  id="agents-md"
  title="AGENTS.md"
  description="The project root file plus any in parent directories of the working directory."
  surface={false}
>
  {@render list(
    agents,
    "No AGENTS.md",
    "Add an AGENTS.md to the project root to give agents standing instructions.",
  )}
</SettingsSection>

<SettingsSection
  id="append-system"
  title="Append to system prompt"
  description="Added to the end of the system prompt."
  surface={false}
>
  {@render list(
    append,
    "No .nerve/APPEND_SYSTEM.md",
    "Add .nerve/APPEND_SYSTEM.md to append text to every system prompt in this project.",
  )}
</SettingsSection>
