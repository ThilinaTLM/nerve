<script lang="ts">
import ChevronsDownUp from "@lucide/svelte/icons/chevrons-down-up";
import Ellipsis from "@lucide/svelte/icons/ellipsis";
import Files from "@lucide/svelte/icons/files";
import Folder from "@lucide/svelte/icons/folder";
import Link from "@lucide/svelte/icons/link";
import ListFilter from "@lucide/svelte/icons/list-filter";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import Search from "@lucide/svelte/icons/search";
import Upload from "@lucide/svelte/icons/upload";
import type { FilesystemProjectEntry } from "@nervekit/contracts/filesystem";
import ContextMenuList, {
  type ContextMenuItem,
} from "@nervekit/ui-kit/components/composites/context-menu-list";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import SearchInput from "@nervekit/ui-kit/components/composites/search-input";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as DropdownMenu from "@nervekit/ui-kit/components/ui/dropdown-menu";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { cn } from "@nervekit/ui-kit/utils";
import type { FileExplorerDirectoryState } from "../state/file-explorer-state.svelte";
import type { FileExplorerTreeItem } from "../state/file-explorer-tree";
import { renameSelectionEnd } from "../state/file-explorer-paths";
import type { FilesPanelPreferences } from "../state/files-panel-preferences";
import {
  fileTreeGitDecoration,
  type FileGitDecoration,
} from "../state/file-git-status";
import type {
  PanelTreeController,
  PanelTreeNode,
} from "$lib/presentation/panels";
import {
  PanelEmpty,
  PanelHeader,
  PanelToolbarButton,
  PanelTree,
  PanelView,
} from "$lib/presentation/panels";
import FileExplorerNameEditor from "./FileExplorerNameEditor.svelte";
import MaterialFileIcon from "./MaterialFileIcon.svelte";

let {
  projectName,
  root,
  nodes,
  expandedIds,
  busy,
  statusIssues = [],
  isEntryOpen,
  selectedPaths,
  gitDecorations,
  preferences,
  filterOpen = $bindable(false),
  filterText = $bindable(""),
  renamingPath,
  siblingNames,
  rootMenu,
  itemMenu,
  dropTargetPath,
  rootDropActive = false,
  externalDropHint = false,
  pendingDelete,
  deleteDescription,
  deleteLabel,
  pendingReplace,
  cutPaths,
  treeController = $bindable(),
  onPreferenceChange,
  onQuickOpen,
  onCollapseAll,
  onRefresh,
  onRetry,
  onRetryStatus,
  onActivate,
  onExpansionChange,
  onItemClick,
  onItemKeydown,
  onDragStart,
  onDragEnd,
  onItemDragEnter,
  onItemDragOver,
  onItemDragLeave,
  onItemDrop,
  onRootDragOver,
  onRootDragLeave,
  onRootDrop,
  onCommitEdit,
  onCancelEdit,
  onConfirmDelete,
  onCancelDelete,
  onConfirmReplace,
  onCancelReplace,
}: {
  /** Undefined means no project is selected. */
  projectName?: string;
  root?: FileExplorerDirectoryState;
  nodes: PanelTreeNode<FileExplorerTreeItem>[];
  expandedIds: ReadonlySet<string>;
  busy: boolean;
  /** Live-update or Git status problems; shown as a retryable header warning. */
  statusIssues?: readonly string[];
  isEntryOpen: (path: string) => boolean;
  /** Selected entry paths (multi-select, or the active file). */
  selectedPaths: ReadonlySet<string>;
  gitDecorations: ReadonlyMap<string, FileGitDecoration>;
  preferences: FilesPanelPreferences;
  filterOpen?: boolean;
  filterText?: string;
  /** Path of the entry whose name is being edited inline. */
  renamingPath?: string;
  /** Names already used in a directory, for inline validation. */
  siblingNames: (directoryPath: string) => ReadonlySet<string>;
  rootMenu: () => ContextMenuItem[];
  itemMenu: (item: FileExplorerTreeItem) => ContextMenuItem[];
  /** Folder row highlighted as the drop target while dragging. */
  dropTargetPath?: string;
  rootDropActive?: boolean;
  /** True while OS files are dragged over the panel. */
  externalDropHint?: boolean;
  pendingDelete?: readonly FilesystemProjectEntry[];
  deleteDescription?: string;
  deleteLabel: string;
  /** Server message listing what dropped files would overwrite. */
  pendingReplace?: string;
  /** Paths on the cut clipboard; they recede until pasted. */
  cutPaths: ReadonlySet<string>;
  treeController?: PanelTreeController;
  onPreferenceChange: <K extends keyof FilesPanelPreferences>(
    key: K,
    value: FilesPanelPreferences[K],
  ) => void;
  onQuickOpen: () => void;
  onCollapseAll: () => void;
  onRefresh: () => void;
  onRetry: () => void;
  onRetryStatus?: () => void;
  onActivate: (item: FileExplorerTreeItem) => void;
  onExpansionChange: (item: FileExplorerTreeItem, expanded: boolean) => void;
  onItemClick: (event: MouseEvent, item: FileExplorerTreeItem) => boolean;
  onItemKeydown: (event: KeyboardEvent, item: FileExplorerTreeItem) => boolean;
  onDragStart: (event: DragEvent, item: FileExplorerTreeItem) => void;
  onDragEnd: (event: DragEvent) => void;
  onItemDragEnter: (event: DragEvent, item: FileExplorerTreeItem) => void;
  onItemDragOver: (event: DragEvent, item: FileExplorerTreeItem) => void;
  onItemDragLeave: (event: DragEvent, item: FileExplorerTreeItem) => void;
  onItemDrop: (event: DragEvent, item: FileExplorerTreeItem) => void;
  onRootDragOver: (event: DragEvent) => void;
  onRootDragLeave: (event: DragEvent) => void;
  onRootDrop: (event: DragEvent) => void;
  onCommitEdit: (item: FileExplorerTreeItem, name: string) => void;
  onCancelEdit: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onConfirmReplace: () => void;
  onCancelReplace: () => void;
} = $props();

function itemPath(item: FileExplorerTreeItem): string | undefined {
  return item.type === "entry" ? item.entry.path : undefined;
}

function isDraggableEntry(item: FileExplorerTreeItem): boolean {
  return (
    item.type === "entry" &&
    item.entry.path !== renamingPath &&
    (item.entry.kind === "file" || item.entry.kind === "directory")
  );
}

function isEditing(item: FileExplorerTreeItem): boolean {
  return (
    item.type === "editor" ||
    (item.type === "entry" && item.entry.path === renamingPath)
  );
}

const filtering = $derived(filterText.trim().length > 0);

function closeFilter(): void {
  filterOpen = false;
  filterText = "";
}
</script>

{#snippet header()}
  <PanelHeader title="Files">
    {#snippet trailing()}
      {#if statusIssues.length > 0}
        <PanelToolbarButton
          icon={TriangleAlert}
          label="Retry live updates and Git status"
          title={`${statusIssues.join("\n")}\nClick to retry.`}
          class="text-warning"
          disabled={busy}
          onclick={onRetryStatus}
        />
      {/if}
      <PanelToolbarButton
        icon={Search}
        label="Go to file"
        disabled={projectName === undefined}
        onclick={onQuickOpen}
      />
      <PanelToolbarButton
        icon={ListFilter}
        label="Filter files"
        active={filterOpen}
        disabled={projectName === undefined || !root}
        onclick={() => (filterOpen ? closeFilter() : (filterOpen = true))}
      />
      <PanelToolbarButton
        icon={ChevronsDownUp}
        label="Collapse all folders"
        disabled={projectName === undefined || expandedIds.size === 0}
        onclick={onCollapseAll}
      />
      <PanelToolbarButton
        icon={RefreshCw}
        label="Refresh files"
        loading={busy}
        disabled={projectName === undefined || !root || busy}
        onclick={onRefresh}
      />
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="ghost"
              size="icon-sm"
              class="shrink-0"
              aria-label="Files options"
              title="Files options"
            >
              <Ellipsis aria-hidden="true" />
            </Button>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end">
          <DropdownMenu.CheckboxItem
            checked={preferences.hideIgnored}
            onCheckedChange={(checked) =>
              onPreferenceChange("hideIgnored", checked)}
          >
            Hide ignored files
          </DropdownMenu.CheckboxItem>
          <DropdownMenu.CheckboxItem
            checked={preferences.showDotfiles}
            onCheckedChange={(checked) =>
              onPreferenceChange("showDotfiles", checked)}
          >
            Show dotfiles
          </DropdownMenu.CheckboxItem>
          <DropdownMenu.CheckboxItem
            checked={preferences.autoReveal}
            onCheckedChange={(checked) =>
              onPreferenceChange("autoReveal", checked)}
          >
            Auto reveal active file
          </DropdownMenu.CheckboxItem>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    {/snippet}
  </PanelHeader>
  {#if filterOpen}
    <div class="pb-1">
      <SearchInput
        bind:value={filterText}
        placeholder="Filter loaded files"
        ariaLabel="Filter files by name"
        onkeydown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            closeFilter();
          }
        }}
      />
    </div>
  {/if}
{/snippet}

<PanelView banner={header}>
  {#if projectName === undefined}
    <PanelEmpty
      icon={Files}
      title="No project selected"
      description="Select a project to browse its files."
    />
  {:else if !root || (root.loading && root.entries.length === 0)}
    <div class="flex min-h-24 items-center justify-center">
      <Spinner class="size-4 text-muted-foreground" />
    </div>
  {:else if root.error && root.entries.length === 0}
    <PanelEmpty
      icon={TriangleAlert}
      title="Could not load files"
      description={root.error}
    >
      {#snippet action()}
        <PanelToolbarButton
          icon={RefreshCw}
          label="Retry loading files"
          title="Retry"
          onclick={onRetry}
        />
      {/snippet}
    </PanelEmpty>
  {:else}
    <ContextMenuList
      items={rootMenu()}
      triggerClass="flex min-h-0 flex-1 flex-col"
    >
      <!-- Empty tree space is the drop target for "move to project root". -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class={cn(
          "relative -mx-2 flex min-h-0 flex-1 flex-col px-2",
          rootDropActive && "bg-primary-subtle",
        )}
        ondragover={onRootDragOver}
        ondragleave={onRootDragLeave}
        ondrop={onRootDrop}
      >
        {#if externalDropHint}
          <div
            class="pointer-events-none absolute inset-x-2 bottom-2 z-10 flex items-center justify-center gap-1.5 rounded-md bg-popover py-1.5 text-caption text-muted-foreground shadow-overlay"
          >
            <Upload class="size-3.5" aria-hidden="true" />
            Drop to add files to the highlighted folder
          </div>
        {/if}
        {#if nodes.length === 0 && filtering}
          <PanelEmpty
            icon={ListFilter}
            title="No matching files"
            description="Only folders that are already open are searched."
          />
        {:else if nodes.length === 0}
          <PanelEmpty icon={Folder} title="This project is empty" />
        {:else}
          <PanelTree
            {nodes}
            ariaLabel={`${projectName} files`}
            virtualized
            horizontalScroll
            multiselectable
            showDisclosure={false}
            bind:controller={treeController}
            {expandedIds}
            getItemTitle={(item) =>
              item.type === "entry"
                ? item.entry.path
                : item.type === "error"
                  ? item.message
                  : item.type === "editor"
                    ? ""
                    : "Load more files"}
            getItemSelected={(item) => {
              const path = itemPath(item);
              return path !== undefined && selectedPaths.has(path);
            }}
            getItemDraggable={isDraggableEntry}
            getItemDimmed={(item) =>
              item.type === "entry" &&
              (item.entry.ignored === true ||
                cutPaths.has(item.entry.path) ||
                fileTreeGitDecoration(gitDecorations, item.entry.path)
                  ?.ignored === true)}
            getItemDropTarget={(item) =>
              item.type === "entry" && item.entry.path === dropTargetPath}
            getItemEditing={isEditing}
            getItemTone={(item) =>
              item.type === "entry"
                ? fileTreeGitDecoration(gitDecorations, item.entry.path)?.tone
                : undefined}
            getItemMenuItems={itemMenu}
            {onItemClick}
            {onItemKeydown}
            onItemActivate={onActivate}
            onItemExpansionChange={onExpansionChange}
            onItemDragStart={onDragStart}
            onItemDragEnd={(event) => onDragEnd(event)}
            {onItemDragEnter}
            {onItemDragOver}
            {onItemDragLeave}
            {onItemDrop}
          >
            {#snippet itemLeading(item)}
              {#if item.type === "entry"}
                {@const open = isEntryOpen(item.entry.path)}
                <MaterialFileIcon
                  name={item.entry.name}
                  kind={item.entry.kind}
                  {open}
                />
                {#if item.entry.symlink}
                  <Link class="size-2.5" aria-hidden="true" />
                {/if}
              {:else if item.type === "editor"}
                <MaterialFileIcon
                  name=""
                  kind={item.mode === "create" ? item.kind : "file"}
                />
              {:else if item.type === "error"}
                <TriangleAlert
                  class="size-3.5 text-destructive"
                  aria-hidden="true"
                />
              {/if}
            {/snippet}
            {#snippet itemEditor(item)}
              {#if item.type === "editor" && item.mode === "create"}
                <FileExplorerNameEditor
                  ariaLabel={item.kind === "file"
                    ? "New file name"
                    : "New folder name"}
                  siblings={siblingNames(item.parentPath)}
                  onCommit={(name) => onCommitEdit(item, name)}
                  onCancel={onCancelEdit}
                />
              {:else if item.type === "entry"}
                <FileExplorerNameEditor
                  ariaLabel={`Rename ${item.entry.name}`}
                  initialName={item.entry.name}
                  current={item.entry.name}
                  selectionEnd={renameSelectionEnd(
                    item.entry.name,
                    item.entry.kind === "directory",
                  )}
                  siblings={siblingNames(
                    item.entry.path.includes("/")
                      ? item.entry.path.slice(
                          0,
                          item.entry.path.lastIndexOf("/"),
                        )
                      : "",
                  )}
                  onCommit={(name) => onCommitEdit(item, name)}
                  onCancel={onCancelEdit}
                />
              {/if}
            {/snippet}
            {#snippet itemBadges(item)}
              {#if item.type === "entry"}
                {@const decoration = fileTreeGitDecoration(
                  gitDecorations,
                  item.entry.path,
                )}
                {#if decoration && item.entry.kind === "directory" && decoration.tone !== "neutral"}
                  <span
                    class={cn("flex w-3 justify-center", decoration.class)}
                    role="img"
                    title={decoration.title}
                    aria-label={decoration.title}
                    ><span class="size-1.5 rounded-full bg-current"
                    ></span></span
                  >
                {:else if decoration?.label && item.entry.kind === "file"}
                  <span
                    class={cn("w-3 text-center text-ui", decoration.class)}
                    title={decoration.title}
                    aria-label={decoration.title}>{decoration.label}</span
                  >
                {/if}
              {/if}
            {/snippet}
          </PanelTree>
        {/if}
      </div>
    </ContextMenuList>
  {/if}
</PanelView>

<ConfirmDialog
  open={Boolean(pendingDelete?.length)}
  title={deleteLabel === "Delete" ? "Delete permanently?" : "Move to trash?"}
  description={deleteDescription}
  confirmLabel={deleteLabel === "Delete" ? "Delete" : "Move to Trash"}
  destructive
  onConfirm={onConfirmDelete}
  onOpenChange={(open) => {
    if (!open) onCancelDelete();
  }}
/>

<ConfirmDialog
  open={Boolean(pendingReplace)}
  title="Replace existing files?"
  description={pendingReplace}
  confirmLabel="Replace"
  destructive
  onConfirm={onConfirmReplace}
  onOpenChange={(open) => {
    if (!open) onCancelReplace();
  }}
/>
