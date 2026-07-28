<script lang="ts">
import ArrowDownToLine from "@lucide/svelte/icons/arrow-down-to-line";
import ArrowUpFromLine from "@lucide/svelte/icons/arrow-up-from-line";
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import X from "@lucide/svelte/icons/x";
import type { GitFileChange } from "@nervekit/contracts";
import { ScrollArea } from "@nervekit/ui-kit/components/ui/scroll-area";
import { cn } from "@nervekit/ui-kit/core/utils";
import {
  buildPanelTree,
  PanelList,
  PanelRow,
  PanelToolbarButton,
  PanelTree,
} from "@nervekit/workbench-ui/panel";
import type { FileMutation, GitPanelCapabilities } from "./git-panel-types";
import { fileStatusLabel, fileTone, statusLetter } from "./git-change-format";

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
  capabilities: GitPanelCapabilities;
  onMutateFile: (
    repo: string,
    file: GitFileChange,
    action: "stage" | "unstage" | "discard",
  ) => void;
  onBulkStage: (repo: string, action: "stage-all" | "unstage-all") => void;
  onRequestDiscard: (file: GitFileChange) => void;
};

let {
  changes,
  stagedFiles,
  unstagedFiles,
  fileMutation,
  bulkMutation,
  selectedRepo,
  capabilities,
  onMutateFile,
  onBulkStage,
  onRequestDiscard,
}: Props = $props();

let stagedExpanded = $state(true);
let unstagedExpanded = $state(true);
</script>

{#snippet changeGroup(
  title: string,
  files: GitFileChange[],
  group: "staged" | "unstaged",
  expanded: boolean,
  onToggle: () => void,
)}
  <PanelRow
    label={title}
    title={`${expanded ? "Collapse" : "Expand"} ${title.toLowerCase()} changes`}
    dense
    flush
    hoverable={false}
    alwaysShowActions
    ariaExpanded={expanded}
    role="none"
    class="font-medium"
    onclick={onToggle}
  >
    {#snippet leading()}
      {#if expanded}
        <ChevronDown class="-mr-1 size-3" aria-hidden="true" />
      {:else}
        <ChevronRight class="-mr-1 size-3" aria-hidden="true" />
      {/if}
    {/snippet}
    {#snippet badges()}
      <span>{files.length}</span>
    {/snippet}
    {#snippet actions()}
      <PanelToolbarButton
        icon={group === "staged" ? ArrowDownToLine : ArrowUpFromLine}
        label={group === "staged" ? "Unstage all" : "Stage all"}
        dense
        loading={bulkMutation ===
          (group === "staged" ? "unstage-all" : "stage-all")}
        disabled={files.length === 0 ||
          !capabilities.bulkMutateFiles.enabled ||
          Boolean(bulkMutation) ||
          Boolean(fileMutation)}
        onclick={() =>
          onBulkStage(
            selectedRepo,
            group === "staged" ? "unstage-all" : "stage-all",
          )}
      />
    {/snippet}
  </PanelRow>

  {#if expanded}
    <PanelTree
      nodes={buildPanelTree(files, {
        getPath: (file) => file.path.split("/"),
        getKey: (file) => `${group}:${file.path}`,
      })}
      ariaLabel={`${title} file tree`}
      baseIndent={0}
      getItemTitle={(file) =>
        `${fileStatusLabel(file, group)} · ${file.renamedFrom ? `${file.renamedFrom} → ` : ""}${file.path}`}
    >
      {#snippet itemLeading(file)}
        <span
          class={cn("font-mono font-semibold", fileTone(file))}
          title={fileStatusLabel(file, group)}
        >
          {statusLetter(file, group)}
        </span>
      {/snippet}
      {#snippet itemActions(file)}
        {@const busy = fileMutation?.path === file.path}
        <PanelToolbarButton
          icon={group === "staged" ? ArrowDownToLine : ArrowUpFromLine}
          label={group === "staged"
            ? `Unstage ${file.path}`
            : `Stage ${file.path}`}
          title={group === "staged" ? "Unstage" : "Stage"}
          dense
          loading={busy &&
            fileMutation?.action === (group === "staged" ? "unstage" : "stage")}
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
          dense
          loading={busy && fileMutation?.action === "discard"}
          disabled={!capabilities.mutateFiles.enabled || busy}
          onclick={() => onRequestDiscard(file)}
        />
      {/snippet}
    </PanelTree>
  {/if}
{/snippet}

<div class="flex min-h-0 flex-1 flex-col">
  {#if !changes}
    <p class="py-1 text-xs text-muted-foreground">Loading…</p>
  {:else if changes.files.length === 0}
    <p class="py-1 text-xs text-muted-foreground">Working tree clean.</p>
  {:else}
    <ScrollArea class="min-h-0 flex-1" viewportClass="min-w-0">
      <PanelList role="none" class="py-0.5">
        {#if stagedFiles.length > 0}
          {@render changeGroup(
            "Staged",
            stagedFiles,
            "staged",
            stagedExpanded,
            () => (stagedExpanded = !stagedExpanded),
          )}
        {/if}
        {#if unstagedFiles.length > 0}
          {@render changeGroup(
            "Unstaged",
            unstagedFiles,
            "unstaged",
            unstagedExpanded,
            () => (unstagedExpanded = !unstagedExpanded),
          )}
        {/if}
      </PanelList>
    </ScrollArea>
  {/if}
</div>
