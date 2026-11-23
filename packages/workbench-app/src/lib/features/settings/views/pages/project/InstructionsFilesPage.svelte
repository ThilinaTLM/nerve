<!--
  Prompt files read for conversations in this project: AGENTS.md (the project
  root and parent directories of the working directory) and
  .nerve/APPEND_SYSTEM.md. Nothing is read from the user folder.
-->
<script lang="ts">
import {
  PageEmptyState,
  PageItem,
  PageList,
} from "@nervekit/ui-kit/components/composites/page";
import FileText from "@lucide/svelte/icons/file-text";
import { SettingsSection } from "$lib/presentation/settings";

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

{#snippet list(items: InstructionsFile[])}
  {#if items.length === 0}
    <PageEmptyState
      variant="card"
      title={loading ? "Looking for files…" : "Not found."}
    />
  {:else}
    <PageList>
      {#each items as file (file.path)}
        <PageItem
          title={file.path}
          icon={FileText}
          summary={file.description}
          onOpen={onOpen ? () => onOpen?.(file.path) : undefined}
          openLabel={`Open ${file.path}`}
        />
      {/each}
    </PageList>
  {/if}
{/snippet}

<SettingsSection
  id="agents-md"
  title="AGENTS.md"
  description="From the project root and the parent directories of the working directory."
  surface={false}
>
  {@render list(agents)}
</SettingsSection>

<SettingsSection
  id="append-system"
  title="Append to system prompt"
  surface={false}
>
  {@render list(append)}
</SettingsSection>
