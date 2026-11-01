<script lang="ts">
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import Files from "@lucide/svelte/icons/files";
import Folder from "@lucide/svelte/icons/folder";
import Link from "@lucide/svelte/icons/link";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import type { FilesystemProjectEntry } from "@nervekit/contracts/filesystem";
import ContextMenuList, {
  type ContextMenuItem,
} from "@nervekit/ui-kit/components/composites/context-menu-list";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { cn } from "@nervekit/ui-kit/utils";
import type { FileExplorerDirectoryState } from "../state/file-explorer-state.svelte";
import type { FileExplorerTreeItem } from "../state/file-explorer-tree";
import {
  fileTreeGitDecoration,
  type FileGitDecoration,
} from "../state/file-git-status";
import type { PanelTreeNode } from "$lib/presentation/panels";
import {
  PanelEmpty,
  PanelHeader,
  PanelToolbarButton,
  PanelTree,
  PanelView,
} from "$lib/presentation/panels";
import CreateProjectEntryDialog from "./CreateProjectEntryDialog.svelte";
import MaterialFileIcon from "./MaterialFileIcon.svelte";

let {
  projectName,
  root,
  nodes,
  expandedIds,
  busy,
  isEntryOpen,
  activeRelativePath,
  gitDecorations,
  rootMenu,
  itemMenu,
  pendingCreate,
  createOpen = $bindable(false),
  pendingTrash,
  onRefresh,
  onRetry,
  onActivate,
  onExpansionChange,
  onDragStart,
  onCreate,
  onConfirmTrash,
  onCancelTrash,
}: {
  /** Undefined means no project is selected. */
  projectName?: string;
  root?: FileExplorerDirectoryState;
  nodes: PanelTreeNode<FileExplorerTreeItem>[];
  expandedIds: ReadonlySet<string>;
  busy: boolean;
  isEntryOpen: (path: string) => boolean;
  activeRelativePath?: string;
  gitDecorations: ReadonlyMap<string, FileGitDecoration>;
  rootMenu: () => ContextMenuItem[];
  itemMenu: (item: FileExplorerTreeItem) => ContextMenuItem[];
  pendingCreate?: {
    kind: "file" | "directory";
    parent: FilesystemProjectEntry;
  };
  createOpen?: boolean;
  pendingTrash?: FilesystemProjectEntry;
  onRefresh: () => void;
  onRetry: () => void;
  onActivate: (item: FileExplorerTreeItem) => void;
  onExpansionChange: (item: FileExplorerTreeItem, expanded: boolean) => void;
  onDragStart: (event: DragEvent, item: FileExplorerTreeItem) => void;
  onCreate: (name: string) => Promise<void>;
  onConfirmTrash: () => void;
  onCancelTrash: () => void;
} = $props();

function itemPath(item: FileExplorerTreeItem): string | undefined {
  return item.type === "entry" ? item.entry.path : undefined;
}

function isDraggableEntry(item: FileExplorerTreeItem): boolean {
  return (
    item.type === "entry" &&
    (item.entry.kind === "file" || item.entry.kind === "directory")
  );
}
</script>

{#snippet header()}
  <PanelHeader title="Files" count={root?.entries.length}>
    {#snippet trailing()}
      <PanelToolbarButton
        icon={RefreshCw}
        label="Refresh files"
        loading={busy}
        disabled={projectName === undefined || !root || busy}
        onclick={onRefresh}
      />
    {/snippet}
  </PanelHeader>
  {#if root?.error && root.entries.length === 0}
    <Callout layout="strip" tone="destructive" icon={TriangleAlert}>
      <span>{root.error}</span>
    </Callout>
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
      {#if root.entries.length === 0}
        <PanelEmpty icon={Folder} title="This project is empty" />
      {:else}
        <PanelTree
          {nodes}
          ariaLabel={`${projectName} files`}
          virtualized
          horizontalScroll
          showDisclosure={false}
          {expandedIds}
          getItemTitle={(item) =>
            item.type === "entry"
              ? item.entry.path
              : item.type === "error"
                ? item.message
                : "Load more files"}
          getItemSelected={(item) => itemPath(item) === activeRelativePath}
          getItemDraggable={isDraggableEntry}
          onItemDragStart={onDragStart}
          getItemTone={(item) =>
            item.type === "entry"
              ? fileTreeGitDecoration(gitDecorations, item.entry.path)?.tone
              : undefined}
          getItemMenuItems={itemMenu}
          onItemActivate={onActivate}
          onItemExpansionChange={onExpansionChange}
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
            {:else if item.type === "error"}
              <TriangleAlert
                class="size-3.5 text-destructive"
                aria-hidden="true"
              />
            {/if}
          {/snippet}
          {#snippet itemBadges(item)}
            {#if item.type === "entry" && item.entry.kind === "file"}
              {@const decoration = fileTreeGitDecoration(
                gitDecorations,
                item.entry.path,
              )}
              {#if decoration?.label}
                <span
                  class={cn(
                    "w-3 text-center text-ui font-medium",
                    decoration.class,
                  )}
                  title={decoration.title}
                  aria-label={decoration.title}>{decoration.label}</span
                >
              {/if}
            {/if}
          {/snippet}
        </PanelTree>
      {/if}
    </ContextMenuList>
  {/if}
</PanelView>

{#if pendingCreate}
  <CreateProjectEntryDialog
    bind:open={createOpen}
    kind={pendingCreate.kind}
    parentPath={pendingCreate.parent.path}
    {onCreate}
  />
{/if}

<ConfirmDialog
  open={Boolean(pendingTrash)}
  title="Move to trash?"
  description={pendingTrash
    ? `“${pendingTrash.name}” will be moved to the operating-system trash and may be recoverable there.`
    : undefined}
  confirmLabel="Move to Trash"
  destructive
  onConfirm={onConfirmTrash}
  onOpenChange={(open) => {
    if (!open) onCancelTrash();
  }}
/>
