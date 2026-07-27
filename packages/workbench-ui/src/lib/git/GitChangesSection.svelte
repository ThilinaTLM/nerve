<script lang="ts">
import ArrowDownToLine from "@lucide/svelte/icons/arrow-down-to-line";
import ArrowUpFromLine from "@lucide/svelte/icons/arrow-up-from-line";
import FilePen from "@lucide/svelte/icons/file-pen";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import X from "@lucide/svelte/icons/x";
import type { GitFileChange } from "@nervekit/contracts";
import { cn } from "@nervekit/ui-kit/core/utils";
import {
  PanelList,
  PanelRow,
  PanelSection,
  PanelSectionHeader,
  PanelToolbarButton,
} from "@nervekit/workbench-ui/panel";
import type { FileMutation, GitPanelCapabilities } from "./git-panel-types";
import {
  fileStatusLabel,
  fileTone,
  shortenPath,
  splitPath,
  statusLetter,
} from "./git-change-format";

type ChangesState = {
  files: readonly GitFileChange[];
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
};

type Props = {
  changes?: ChangesState;
  stagedFiles: GitFileChange[];
  unstagedFiles: GitFileChange[];
  fileMutation?: FileMutation;
  bulkMutation?: string;
  selectedRepo: string;
  loadingOverview: boolean;
  capabilities: GitPanelCapabilities;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onMutateFile: (
    repo: string,
    file: GitFileChange,
    action: "stage" | "unstage" | "discard",
  ) => void;
  onBulkStage: (repo: string, action: "stage-all" | "unstage-all") => void;
  onRefresh: (repo: string) => void;
  onRequestDiscard: (file: GitFileChange) => void;
};

let {
  changes,
  stagedFiles,
  unstagedFiles,
  fileMutation,
  bulkMutation,
  selectedRepo,
  loadingOverview,
  capabilities,
  open = $bindable(true),
  onOpenChange,
  onMutateFile,
  onBulkStage,
  onRefresh,
  onRequestDiscard,
}: Props = $props();

const changeCount = $derived(changes?.files.length ?? 0);
</script>

{#snippet changeGroup(
  title: string,
  files: GitFileChange[],
  group: "staged" | "unstaged",
)}
  <PanelSectionHeader {title} count={files.length}>
    {#snippet actions()}
      <PanelToolbarButton
        icon={group === "staged" ? ArrowDownToLine : ArrowUpFromLine}
        label={group === "staged" ? "Unstage all" : "Stage all"}
        loading={bulkMutation ===
          (group === "staged" ? "unstage-all" : "stage-all")}
        disabled={!capabilities.bulkMutateFiles.enabled ||
          Boolean(bulkMutation) ||
          Boolean(fileMutation)}
        onclick={() =>
          onBulkStage(
            selectedRepo,
            group === "staged" ? "unstage-all" : "stage-all",
          )}
      />
    {/snippet}
  </PanelSectionHeader>
  <PanelList ariaLabel={`${title} files`}>
    {#each files as file (file.path)}
      {@const parts = splitPath(shortenPath(file.path))}
      {@const busy = fileMutation?.path === file.path}
      <PanelRow
        label={parts.base}
        description={parts.dir}
        title={`${fileStatusLabel(file, group)} · ${file.path}`}
        mono
        indent={1}
      >
        {#snippet badges()}
          <span
            class={cn("font-mono font-semibold", fileTone(file))}
            title={fileStatusLabel(file, group)}
          >
            {statusLetter(file, group)}
          </span>
        {/snippet}
        {#snippet actions()}
          <PanelToolbarButton
            icon={group === "staged" ? ArrowDownToLine : ArrowUpFromLine}
            label={group === "staged"
              ? `Unstage ${file.path}`
              : `Stage ${file.path}`}
            title={group === "staged" ? "Unstage" : "Stage"}
            loading={busy &&
              fileMutation?.action ===
                (group === "staged" ? "unstage" : "stage")}
            disabled={!capabilities.mutateFiles.enabled || busy}
            onclick={() =>
              onMutateFile(
                selectedRepo,
                file,
                group === "staged" ? "unstage" : "stage",
              )}
          />
          <PanelToolbarButton
            icon={X}
            label={`Discard ${file.path}`}
            title="Discard"
            loading={busy && fileMutation?.action === "discard"}
            disabled={!capabilities.mutateFiles.enabled || busy}
            onclick={() => onRequestDiscard(file)}
          />
        {/snippet}
      </PanelRow>
    {/each}
  </PanelList>
{/snippet}

<PanelSection
  title="Changes"
  icon={FilePen}
  count={changeCount}
  bind:open
  {onOpenChange}
>
  {#snippet actions()}
    <PanelToolbarButton
      icon={RefreshCw}
      label="Refresh changes"
      loading={loadingOverview}
      disabled={!capabilities.refresh.enabled || loadingOverview}
      onclick={() => onRefresh(selectedRepo)}
    />
  {/snippet}

  {#if !changes}
    <p class="px-2 py-1 text-xs text-muted-foreground">Loading…</p>
  {:else if changes.files.length === 0}
    <p class="px-2 py-1 text-xs text-muted-foreground">Working tree clean.</p>
  {:else}
    {#if stagedFiles.length > 0}
      {@render changeGroup("Staged", stagedFiles, "staged")}
    {/if}
    {#if unstagedFiles.length > 0}
      {@render changeGroup("Unstaged", unstagedFiles, "unstaged")}
    {/if}
  {/if}
</PanelSection>
