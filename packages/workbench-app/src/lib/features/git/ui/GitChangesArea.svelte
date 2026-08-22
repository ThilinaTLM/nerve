<script lang="ts">
import Archive from "@lucide/svelte/icons/archive";
import ArrowDownToLine from "@lucide/svelte/icons/arrow-down-to-line";
import ArrowUpFromLine from "@lucide/svelte/icons/arrow-up-from-line";
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import Eye from "@lucide/svelte/icons/eye";
import Trash2 from "@lucide/svelte/icons/trash-2";
import X from "@lucide/svelte/icons/x";
import type {
  GitDiffArea,
  GitFileChange,
  GitStashArea,
} from "@nervekit/contracts";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/ui/context-menu-list";
import { ScrollArea } from "@nervekit/ui-kit/components/ui/scroll-area";
import { cn } from "@nervekit/ui-kit/core/utils";
import {
  buildPanelTree,
  PanelList,
  PanelRow,
  PanelToolbarButton,
  PanelTree,
} from "$lib/presentation/panel";
import {
  gitChangeTreeFolderKey,
  gitExpandedGroupIds,
} from "./git-panel-controller";
import type {
  FileMutation,
  GitPanelCapabilities,
  ScopedFileMutation,
  StashMutation,
} from "./git-panel-types";
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
  bulkMutation?: ScopedFileMutation;
  stashMutation?: StashMutation;
  collapsedFolders: ReadonlySet<string>;
  selectedRepo: string;
  capabilities: GitPanelCapabilities;
  onOpenDiff: (repo: string, file: GitFileChange, area: GitDiffArea) => void;
  onMutateFile: (
    repo: string,
    file: GitFileChange,
    action: "stage" | "unstage" | "discard",
  ) => void;
  onMutateScope: (
    repo: string,
    area: GitStashArea,
    action: ScopedFileMutation["action"],
    path?: string,
  ) => void;
  onCreateStash: (repo: string, area: GitStashArea, path?: string) => void;
  onFolderExpansionChange: (
    repo: string,
    key: string,
    expanded: boolean,
  ) => void;
  onRequestDiscard: (file: GitFileChange) => void;
  onRequestDiscardScope: (area: GitStashArea, path?: string) => void;
};

let {
  changes,
  stagedFiles,
  unstagedFiles,
  fileMutation,
  bulkMutation,
  stashMutation,
  collapsedFolders,
  selectedRepo,
  capabilities,
  onOpenDiff,
  onMutateFile,
  onMutateScope,
  onCreateStash,
  onFolderExpansionChange,
  onRequestDiscard,
  onRequestDiscardScope,
}: Props = $props();

let stagedExpanded = $state(true);
let unstagedExpanded = $state(true);

const anyMutation = $derived(
  Boolean(fileMutation || bulkMutation || stashMutation),
);
const stagedNodes = $derived(
  buildPanelTree(stagedFiles, {
    getPath: (file) => file.path.split("/"),
    getKey: (file) => `staged:${file.path}`,
  }),
);
const unstagedNodes = $derived(
  buildPanelTree(unstagedFiles, {
    getPath: (file) => file.path.split("/"),
    getKey: (file) => `unstaged:${file.path}`,
  }),
);
const stagedExpandedIds = $derived(
  gitExpandedGroupIds(stagedNodes, "staged", collapsedFolders),
);
const unstagedExpandedIds = $derived(
  gitExpandedGroupIds(unstagedNodes, "unstaged", collapsedFolders),
);

function scopeBusy(
  mutation: ScopedFileMutation | undefined,
  action: ScopedFileMutation["action"],
  area: GitStashArea,
  path?: string,
): boolean {
  return (
    mutation?.action === action &&
    mutation.area === area &&
    mutation.path === path
  );
}

function stashScopeBusy(area: GitStashArea, path?: string): boolean {
  return (
    stashMutation?.action === "create" &&
    stashMutation.area === area &&
    stashMutation.path === path
  );
}

function scopeMenu(area: GitStashArea, path?: string): ContextMenuItem[] {
  const stageAction = area === "staged" ? "unstage" : "stage";
  return [
    {
      label: area === "staged" ? "Unstage" : "Stage",
      icon: area === "staged" ? ArrowDownToLine : ArrowUpFromLine,
      disabled: !capabilities.bulkMutateFiles.enabled || anyMutation,
      onSelect: () => onMutateScope(selectedRepo, area, stageAction, path),
    },
    {
      label: "Stash",
      icon: Archive,
      disabled: !capabilities.stashes.enabled || anyMutation,
      onSelect: () => onCreateStash(selectedRepo, area, path),
    },
    { type: "separator" },
    {
      label: "Discard",
      icon: Trash2,
      destructive: true,
      disabled: !capabilities.bulkMutateFiles.enabled || anyMutation,
      onSelect: () => onRequestDiscardScope(area, path),
    },
  ];
}

function fileMenu(area: GitStashArea, file: GitFileChange): ContextMenuItem[] {
  const stageAction = area === "staged" ? "unstage" : "stage";
  return [
    {
      label: "View",
      icon: Eye,
      onSelect: () => onOpenDiff(selectedRepo, file, area),
    },
    {
      label: area === "staged" ? "Unstage" : "Stage",
      icon: area === "staged" ? ArrowDownToLine : ArrowUpFromLine,
      disabled: !capabilities.mutateFiles.enabled || anyMutation,
      onSelect: () => onMutateFile(selectedRepo, file, stageAction),
    },
    {
      label: "Stash",
      icon: Archive,
      disabled: !capabilities.stashes.enabled || anyMutation,
      onSelect: () => onCreateStash(selectedRepo, area, file.path),
    },
    { type: "separator" },
    {
      label: "Discard",
      icon: Trash2,
      destructive: true,
      disabled: !capabilities.mutateFiles.enabled || anyMutation,
      onSelect: () => onRequestDiscard(file),
    },
  ];
}
</script>

{#snippet groupActions(area: GitStashArea)}
  {@const stageAction = area === "staged" ? "unstage" : "stage"}
  <PanelToolbarButton
    icon={area === "staged" ? ArrowDownToLine : ArrowUpFromLine}
    label={`${area === "staged" ? "Unstage" : "Stage"} all`}
    title={`${area === "staged" ? "Unstage" : "Stage"} all`}
    dense
    loading={scopeBusy(bulkMutation, stageAction, area)}
    disabled={!capabilities.bulkMutateFiles.enabled || anyMutation}
    onclick={(event) => {
      event.stopPropagation();
      onMutateScope(selectedRepo, area, stageAction);
    }}
  />
  <PanelToolbarButton
    icon={Archive}
    label={`Stash all ${area} changes`}
    title="Stash all"
    dense
    loading={stashScopeBusy(area)}
    disabled={!capabilities.stashes.enabled || anyMutation}
    onclick={(event) => {
      event.stopPropagation();
      onCreateStash(selectedRepo, area);
    }}
  />
  <PanelToolbarButton
    icon={X}
    label={`Discard all ${area} changes`}
    title="Discard all"
    dense
    loading={scopeBusy(bulkMutation, "discard", area)}
    disabled={!capabilities.bulkMutateFiles.enabled || anyMutation}
    onclick={(event) => {
      event.stopPropagation();
      onRequestDiscardScope(area);
    }}
  />
{/snippet}

{#snippet folderActions(area: GitStashArea, path: string)}
  {@const stageAction = area === "staged" ? "unstage" : "stage"}
  <PanelToolbarButton
    icon={area === "staged" ? ArrowDownToLine : ArrowUpFromLine}
    label={`${area === "staged" ? "Unstage" : "Stage"} ${path}`}
    title={area === "staged" ? "Unstage" : "Stage"}
    dense
    loading={scopeBusy(bulkMutation, stageAction, area, path)}
    disabled={!capabilities.bulkMutateFiles.enabled || anyMutation}
    onclick={(event) => {
      event.stopPropagation();
      onMutateScope(selectedRepo, area, stageAction, path);
    }}
  />
  <PanelToolbarButton
    icon={Archive}
    label={`Stash ${path}`}
    title="Stash"
    dense
    loading={stashScopeBusy(area, path)}
    disabled={!capabilities.stashes.enabled || anyMutation}
    onclick={(event) => {
      event.stopPropagation();
      onCreateStash(selectedRepo, area, path);
    }}
  />
  <PanelToolbarButton
    icon={X}
    label={`Discard changes in ${path}`}
    title="Discard"
    dense
    loading={scopeBusy(bulkMutation, "discard", area, path)}
    disabled={!capabilities.bulkMutateFiles.enabled || anyMutation}
    onclick={(event) => {
      event.stopPropagation();
      onRequestDiscardScope(area, path);
    }}
  />
{/snippet}

{#snippet fileActions(area: GitStashArea, file: GitFileChange)}
  {@const stageAction = area === "staged" ? "unstage" : "stage"}
  {@const busy = fileMutation?.path === file.path}
  <PanelToolbarButton
    icon={area === "staged" ? ArrowDownToLine : ArrowUpFromLine}
    label={`${area === "staged" ? "Unstage" : "Stage"} ${file.path}`}
    title={area === "staged" ? "Unstage" : "Stage"}
    dense
    loading={busy && fileMutation?.action === stageAction}
    disabled={!capabilities.mutateFiles.enabled || anyMutation}
    onclick={(event) => {
      event.stopPropagation();
      onMutateFile(selectedRepo, file, stageAction);
    }}
  />
  <PanelToolbarButton
    icon={Archive}
    label={`Stash ${file.path}`}
    title="Stash"
    dense
    loading={stashScopeBusy(area, file.path)}
    disabled={!capabilities.stashes.enabled || anyMutation}
    onclick={(event) => {
      event.stopPropagation();
      onCreateStash(selectedRepo, area, file.path);
    }}
  />
  <PanelToolbarButton
    icon={X}
    label={`Discard ${file.path}`}
    title="Discard"
    dense
    loading={busy && fileMutation?.action === "discard"}
    disabled={!capabilities.mutateFiles.enabled || anyMutation}
    onclick={(event) => {
      event.stopPropagation();
      onRequestDiscard(file);
    }}
  />
{/snippet}

{#snippet changeGroup(
  title: string,
  files: GitFileChange[],
  area: GitStashArea,
  expanded: boolean,
  onToggle: () => void,
)}
  <PanelRow
    label={`${title} (${files.length})`}
    title={`${expanded ? "Collapse" : "Expand"} ${title.toLowerCase()} changes`}
    menuItems={scopeMenu(area)}
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
    {#snippet actions()}
      {@render groupActions(area)}
    {/snippet}
  </PanelRow>

  {#if expanded}
    {@const nodes = area === "staged" ? stagedNodes : unstagedNodes}
    {@const expandedIds =
      area === "staged" ? stagedExpandedIds : unstagedExpandedIds}
    <PanelTree
      {nodes}
      ariaLabel={`${title} file tree`}
      baseIndent={0}
      showGroupDisclosure={false}
      overlayActions
      {expandedIds}
      getGroupMenuItems={(path) => scopeMenu(area, path.join("/"))}
      getItemMenuItems={(file) => fileMenu(area, file)}
      getItemTitle={(file) =>
        `${fileStatusLabel(file, area)} · ${file.renamedFrom ? `${file.renamedFrom} → ` : ""}${file.path}`}
      onItemActivate={(file) => onOpenDiff(selectedRepo, file, area)}
      onGroupExpansionChange={(path, open) =>
        onFolderExpansionChange(
          selectedRepo,
          gitChangeTreeFolderKey(area, path),
          open,
        )}
    >
      {#snippet groupActions(path)}
        {@render folderActions(area, path.join("/"))}
      {/snippet}
      {#snippet itemLeading(file)}
        <span
          class={cn("font-mono font-semibold", fileTone(file))}
          title={fileStatusLabel(file, area)}
        >
          {statusLetter(file, area)}
        </span>
      {/snippet}
      {#snippet itemActions(file)}
        {@render fileActions(area, file)}
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
