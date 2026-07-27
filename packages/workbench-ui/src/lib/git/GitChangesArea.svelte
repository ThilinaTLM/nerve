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
  PanelList,
  PanelRow,
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
    icon={expanded ? ChevronDown : ChevronRight}
    label={title}
    title={`${expanded ? "Collapse" : "Expand"} ${title.toLowerCase()} changes`}
    dense
    alwaysShowActions
    ariaExpanded={expanded}
    class="font-medium"
    onclick={onToggle}
  >
    {#snippet badges()}
      <span>{files.length}</span>
    {/snippet}
    {#snippet actions()}
      <PanelToolbarButton
        icon={group === "staged" ? ArrowDownToLine : ArrowUpFromLine}
        label={group === "staged" ? "Unstage all" : "Stage all"}
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
    {#each files as file (file.path)}
      {@const parts = splitPath(shortenPath(file.path))}
      {@const busy = fileMutation?.path === file.path}
      <PanelRow
        label={parts.base}
        description={parts.dir}
        title={`${fileStatusLabel(file, group)} · ${file.path}`}
        mono
        dense
        indent={1}
        alwaysShowActions
      >
        {#snippet leading()}
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
  {/if}
{/snippet}

<div class="flex min-h-0 flex-1 flex-col">
  {#if !changes}
    <p class="px-2 py-1 text-xs text-muted-foreground">Loading…</p>
  {:else if changes.files.length === 0}
    <p class="px-2 py-1 text-xs text-muted-foreground">Working tree clean.</p>
  {:else}
    <ScrollArea class="min-h-0 flex-1" viewportClass="min-w-0">
      <PanelList ariaLabel="Git changes" class="py-0.5">
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
