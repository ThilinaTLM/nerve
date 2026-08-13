<script lang="ts">
import Copy from "@lucide/svelte/icons/copy";
import ExternalLink from "@lucide/svelte/icons/external-link";
import FilePlus from "@lucide/svelte/icons/file-plus";
import FileText from "@lucide/svelte/icons/file-text";
import Files from "@lucide/svelte/icons/files";
import Folder from "@lucide/svelte/icons/folder";
import FolderOpen from "@lucide/svelte/icons/folder-open";
import FolderPlus from "@lucide/svelte/icons/folder-plus";
import Link from "@lucide/svelte/icons/link";
import Locate from "@lucide/svelte/icons/locate";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import Trash2 from "@lucide/svelte/icons/trash-2";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import type { ProjectRecord } from "$lib/api";
import type {
  FilesystemProjectEntry,
  GitProjectFileStatus,
} from "@nervekit/contracts";
import ContextMenuList, {
  type ContextMenuItem,
} from "@nervekit/ui-kit/components/ui/context-menu-list";
import ConfirmDialog from "@nervekit/ui-kit/components/ui/confirm-dialog";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { cn } from "@nervekit/ui-kit/core/utils";
import { getProjectGitFileStatus } from "$lib/api";
import { writeClipboardText } from "$lib/core/clipboard";
import { workbenchStartupState } from "$lib/core/startup/workbench-startup-state.svelte";
import {
  desktopRuntime,
  getDesktopBridge,
} from "$lib/features/desktop/state/desktop-bridge.svelte";
import { createProjectEntry } from "$lib/features/filesystem/api/filesystem.api";
import { fileSelectors } from "$lib/features/filesystem/state/file-selectors.svelte";
import {
  closeFileTabsAtPath,
  openFilePane,
} from "$lib/features/filesystem/state/file-tabs.svelte";
import {
  activateFileExplorerItem,
  discardFileExplorerPath,
  ensureFileExplorerRoot,
  loadFileExplorerDirectory,
  refreshFileExplorerProject,
  setFileExplorerItemExpanded,
} from "$lib/features/filesystem/state/file-explorer-actions.svelte";
import { startFileExplorerRefreshScheduler } from "$lib/features/filesystem/state/file-explorer-refresh-scheduler";
import { fileExplorerState } from "$lib/features/filesystem/state/file-explorer-state.svelte";
import {
  buildFileExplorerTree,
  fileExplorerEntryNodeId,
  type FileExplorerEntryItem,
  type FileExplorerTreeItem,
} from "$lib/features/filesystem/state/file-explorer-tree";
import {
  fileTreeGitDecoration,
  indexFileTreeGitDecorations,
} from "$lib/features/filesystem/state/file-git-status";
import {
  errorDetails,
  showCriticalError,
} from "$lib/features/notifications/critical-errors.svelte";
import { notify } from "$lib/features/notifications/notify.svelte";
import {
  formatProjectEntryReference,
  PROJECT_ENTRY_DRAG_MIME,
  serializeProjectEntryDrag,
} from "$lib/presentation/dnd/project-entry-drag";
import {
  PanelBanner,
  PanelEmpty,
  PanelHeader,
  PanelToolbarButton,
  PanelTree,
  PanelView,
} from "$lib/presentation/panel";
import CreateProjectEntryDialog from "./CreateProjectEntryDialog.svelte";
import MaterialFileIcon from "./MaterialFileIcon.svelte";
import {
  absoluteProjectPath,
  buildFileExplorerMenu,
  buildProjectRootMenu,
} from "./file-explorer-menu";

let { activeProject }: { activeProject?: ProjectRecord } = $props();

let gitFiles = $state<GitProjectFileStatus[]>([]);
let pendingCreate = $state<{
  kind: "file" | "directory";
  parent: FilesystemProjectEntry;
}>();
let createOpen = $state(false);
let pendingTrash = $state<FilesystemProjectEntry>();

const project = $derived(
  activeProject ? fileExplorerState.projects[activeProject.id] : undefined,
);
const root = $derived(project?.directories[""]);
const nodes = $derived(project ? buildFileExplorerTree(project) : []);
const gitDecorations = $derived(indexFileTreeGitDecorations(gitFiles));
const activeFile = $derived(fileSelectors.activeCenterFileView);
const activeRelativePath = $derived.by(() => {
  const file = activeFile;
  if (!file || file.projectId !== activeProject?.id) return undefined;
  return file.content?.relativePath ?? file.path;
});
const rootEntry = $derived<FilesystemProjectEntry | undefined>(
  activeProject
    ? {
        name: activeProject.name,
        path: "",
        kind: "directory",
        symlink: false,
      }
    : undefined,
);
const busy = $derived(
  Object.values(project?.directories ?? {}).some(
    (directory) => directory.loading || directory.refreshing,
  ),
);

function itemPath(item: FileExplorerTreeItem): string | undefined {
  return item.type === "entry" ? item.entry.path : undefined;
}

function isDraggableEntry(item: FileExplorerTreeItem): boolean {
  return (
    item.type === "entry" &&
    (item.entry.kind === "file" || item.entry.kind === "directory")
  );
}

function startEntryDrag(event: DragEvent, item: FileExplorerTreeItem): void {
  if (
    item.type !== "entry" ||
    (item.entry.kind !== "file" && item.entry.kind !== "directory") ||
    !event.dataTransfer
  )
    return;
  const entry = { path: item.entry.path, kind: item.entry.kind } as const;
  event.dataTransfer.setData(
    PROJECT_ENTRY_DRAG_MIME,
    serializeProjectEntryDrag([entry]),
  );
  event.dataTransfer.setData("text/plain", formatProjectEntryReference(entry));
  event.dataTransfer.effectAllowed = "copy";
}

function activate(item: FileExplorerTreeItem): void {
  if (!activeProject) return;
  if (item.type === "entry" && item.entry.kind === "file") {
    void openFilePane({ projectId: activeProject.id, path: item.entry.path });
    return;
  }
  activateFileExplorerItem(activeProject.id, item);
}

function openFromMenu(item: FileExplorerEntryItem): void {
  if (!activeProject || !project) return;
  if (item.entry.kind === "file") {
    void openFilePane({ projectId: activeProject.id, path: item.entry.path });
    return;
  }
  if (item.entry.kind === "directory") {
    const id = fileExplorerEntryNodeId(activeProject.id, item.entry.path);
    setFileExplorerItemExpanded(
      activeProject.id,
      item,
      !project.expandedIds.has(id),
    );
  }
}

function parentPath(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator < 0 ? "" : path.slice(0, separator);
}

async function refreshGitStatus(projectId: string): Promise<void> {
  try {
    const response = await getProjectGitFileStatus(projectId);
    if (activeProject?.id === projectId) gitFiles = response.files;
  } catch {
    // Git decoration is best effort; preserve the last successful status.
  }
}

async function refreshAll(projectId: string): Promise<void> {
  await Promise.all([
    refreshFileExplorerProject(projectId),
    refreshGitStatus(projectId),
  ]);
}

async function copyPath(text: string, label: string): Promise<void> {
  try {
    await writeClipboardText(text);
    notify.success(`Copied ${label}`);
  } catch {
    notify.error("Could not copy to clipboard");
  }
}

async function runNativeAction(
  action: "openProjectEntry" | "revealProjectEntry",
  entry: FilesystemProjectEntry,
): Promise<void> {
  if (!activeProject) return;
  const bridge = getDesktopBridge();
  if (!bridge) return;
  try {
    await bridge.files[action]({
      root: activeProject.dir,
      relativePath: entry.path,
    });
  } catch (caught) {
    showCriticalError(
      action === "openProjectEntry"
        ? "Could not open project entry"
        : "Could not reveal project entry",
      errorDetails(caught),
    );
  }
}

function requestCreate(
  kind: "file" | "directory",
  parent: FilesystemProjectEntry,
): void {
  pendingCreate = { kind, parent };
  createOpen = true;
}

async function createEntry(name: string): Promise<void> {
  const target = pendingCreate;
  if (!activeProject || !target) return;
  const response = await createProjectEntry({
    projectId: activeProject.id,
    parentPath: target.parent.path,
    name,
    kind: target.kind,
  });
  await loadFileExplorerDirectory(activeProject.id, target.parent.path, {
    refresh: true,
  });
  setFileExplorerItemExpanded(
    activeProject.id,
    { type: "entry", entry: target.parent },
    true,
  );
  await refreshGitStatus(activeProject.id);
  if (target.kind === "file")
    await openFilePane({
      projectId: activeProject.id,
      path: response.entry.path,
    });
  notify.success(target.kind === "file" ? "File created" : "Folder created");
}

async function movePendingToTrash(): Promise<void> {
  const entry = pendingTrash;
  const currentProject = activeProject;
  const bridge = getDesktopBridge();
  if (!entry || !currentProject || !bridge) return;
  try {
    await bridge.files.trashProjectEntry({
      root: currentProject.dir,
      relativePath: entry.path,
    });
    closeFileTabsAtPath({
      projectId: currentProject.id,
      path: entry.path,
      descendants: entry.kind === "directory",
    });
    discardFileExplorerPath(currentProject.id, entry.path);
    await Promise.all([
      loadFileExplorerDirectory(currentProject.id, parentPath(entry.path), {
        refresh: true,
      }),
      refreshGitStatus(currentProject.id),
    ]);
    notify.success("Moved to trash");
  } catch (caught) {
    showCriticalError("Could not move entry to trash", errorDetails(caught));
  } finally {
    pendingTrash = undefined;
  }
}

function rootMenu(): ContextMenuItem[] {
  const entry = rootEntry;
  if (!activeProject || !entry) return [];
  return buildProjectRootMenu(
    {
      createFile: () => requestCreate("file", entry),
      createFolder: () => requestCreate("directory", entry),
      openDefault: () => void runNativeAction("openProjectEntry", entry),
      reveal: () => void runNativeAction("revealProjectEntry", entry),
      copyPath: () => void copyPath(activeProject.dir, "path"),
    },
    desktopRuntime.isDesktop,
    {
      open: FolderOpen,
      copy: Copy,
      openDefault: ExternalLink,
      newFile: FilePlus,
      reveal: Locate,
      newFolder: FolderPlus,
      trash: Trash2,
    },
  );
}

function itemMenu(item: FileExplorerTreeItem): ContextMenuItem[] {
  if (item.type !== "entry" || !activeProject) return [];
  const entry = item.entry;
  const absolutePath = absoluteProjectPath(
    activeProject.dir,
    entry.path,
    desktopRuntime.platform,
  );
  return buildFileExplorerMenu(
    entry,
    {
      open: () => openFromMenu(item),
      createFile: () => requestCreate("file", entry),
      createFolder: () => requestCreate("directory", entry),
      openDefault: () => void runNativeAction("openProjectEntry", entry),
      reveal: () => void runNativeAction("revealProjectEntry", entry),
      copyPath: () => void copyPath(absolutePath, "path"),
      copyRelativePath: () => void copyPath(entry.path, "relative path"),
      trash: () => (pendingTrash = entry),
    },
    desktopRuntime.isDesktop,
    {
      open: entry.kind === "directory" ? FolderOpen : FileText,
      copy: Copy,
      openDefault: ExternalLink,
      newFile: FilePlus,
      reveal: Locate,
      newFolder: FolderPlus,
      trash: Trash2,
    },
  );
}

$effect(() => {
  if (!createOpen) pendingCreate = undefined;
});

$effect(() => {
  const projectId = activeProject?.id;
  if (!projectId || !workbenchStartupState.progressiveActive) return;
  gitFiles = [];
  void Promise.all([
    ensureFileExplorerRoot(projectId),
    refreshGitStatus(projectId),
  ]);
  return startFileExplorerRefreshScheduler({
    refresh: () => refreshAll(projectId),
  });
});
</script>

{#snippet header()}
  <PanelHeader title="Files" count={root?.entries.length}>
    {#snippet trailing()}
      <PanelToolbarButton
        icon={RefreshCw}
        label="Refresh files"
        loading={busy}
        disabled={!activeProject || !root || busy}
        onclick={() => {
          if (activeProject) void refreshAll(activeProject.id);
        }}
      />
    {/snippet}
  </PanelHeader>
  {#if root?.error && root.entries.length === 0}
    <PanelBanner tone="destructive" icon={TriangleAlert}>
      <span>{root.error}</span>
    </PanelBanner>
  {/if}
{/snippet}

<PanelView scroll={false} padded={false} banner={header}>
  {#if !activeProject}
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
          onclick={() => void ensureFileExplorerRoot(activeProject.id)}
        />
      {/snippet}
    </PanelEmpty>
  {:else if project}
    <ContextMenuList
      items={rootMenu()}
      triggerClass="flex min-h-0 flex-1 flex-col"
    >
      {#if root.entries.length === 0}
        <PanelEmpty icon={Folder} title="This project is empty" />
      {:else}
        <PanelTree
          {nodes}
          ariaLabel={`${activeProject.name} files`}
          virtualized
          horizontalScroll
          showDisclosure={false}
          expandedIds={project.expandedIds}
          getItemTitle={(item) =>
            item.type === "entry"
              ? item.entry.path
              : item.type === "error"
                ? item.message
                : "Load more files"}
          getItemSelected={(item) => itemPath(item) === activeRelativePath}
          getItemDraggable={isDraggableEntry}
          onItemDragStart={startEntryDrag}
          getItemTone={(item) =>
            item.type === "entry"
              ? fileTreeGitDecoration(gitDecorations, item.entry.path)?.tone
              : undefined}
          getItemMenuItems={itemMenu}
          onItemActivate={activate}
          onItemExpansionChange={(item, expanded) =>
            setFileExplorerItemExpanded(activeProject.id, item, expanded)}
        >
          {#snippet itemLeading(item)}
            {#if item.type === "entry"}
              {@const open = project.expandedIds.has(
                fileExplorerEntryNodeId(activeProject.id, item.entry.path),
              )}
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
                    "w-3 text-center text-xs font-medium",
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
    onCreate={createEntry}
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
  onConfirm={() => void movePendingToTrash()}
  onOpenChange={(open) => {
    if (!open) pendingTrash = undefined;
  }}
/>
