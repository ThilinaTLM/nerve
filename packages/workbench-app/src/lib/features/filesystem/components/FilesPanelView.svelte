<script lang="ts">
import File from "@lucide/svelte/icons/file";
import Files from "@lucide/svelte/icons/files";
import Folder from "@lucide/svelte/icons/folder";
import FolderOpen from "@lucide/svelte/icons/folder-open";
import Link from "@lucide/svelte/icons/link";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import type { ProjectRecord } from "$lib/api";
import { workbenchStartupState } from "$lib/core/startup/workbench-startup-state.svelte";
import { fileSelectors } from "$lib/features/filesystem/state/file-selectors.svelte";
import { openFilePane } from "$lib/features/filesystem/state/file-tabs.svelte";
import {
  activateFileExplorerItem,
  ensureFileExplorerRoot,
  refreshFileExplorerProject,
  setFileExplorerItemExpanded,
} from "$lib/features/filesystem/state/file-explorer-actions.svelte";
import { startFileExplorerRefreshScheduler } from "$lib/features/filesystem/state/file-explorer-refresh-scheduler";
import { fileExplorerState } from "$lib/features/filesystem/state/file-explorer-state.svelte";
import {
  buildFileExplorerTree,
  fileExplorerEntryNodeId,
  type FileExplorerTreeItem,
} from "$lib/features/filesystem/state/file-explorer-tree";
import {
  PanelBanner,
  PanelEmpty,
  PanelHeader,
  PanelToolbarButton,
  PanelTree,
  PanelView,
} from "$lib/presentation/panel";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";

let { activeProject }: { activeProject?: ProjectRecord } = $props();

const project = $derived(
  activeProject ? fileExplorerState.projects[activeProject.id] : undefined,
);
const root = $derived(project?.directories[""]);
const nodes = $derived(project ? buildFileExplorerTree(project) : []);
const activeFile = $derived(fileSelectors.activeCenterFileView);
const activeRelativePath = $derived.by(() => {
  const file = activeFile;
  if (!file || file.projectId !== activeProject?.id) return undefined;
  return file.content?.relativePath ?? file.path;
});
const busy = $derived(
  Object.values(project?.directories ?? {}).some(
    (directory) => directory.loading || directory.refreshing,
  ),
);

function itemPath(item: FileExplorerTreeItem): string | undefined {
  return item.type === "entry" ? item.entry.path : undefined;
}

function activate(item: FileExplorerTreeItem): void {
  if (!activeProject) return;
  if (item.type === "entry" && item.entry.kind === "file") {
    void openFilePane({ projectId: activeProject.id, path: item.entry.path });
    return;
  }
  activateFileExplorerItem(activeProject.id, item);
}

$effect(() => {
  const projectId = activeProject?.id;
  if (!projectId || !workbenchStartupState.progressiveActive) return;
  void ensureFileExplorerRoot(projectId);
  return startFileExplorerRefreshScheduler({
    refresh: () => refreshFileExplorerProject(projectId),
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
          if (activeProject) void refreshFileExplorerProject(activeProject.id);
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
  {:else if root.entries.length === 0}
    <PanelEmpty icon={Folder} title="This project is empty" />
  {:else if project}
    <PanelTree
      {nodes}
      ariaLabel={`${activeProject.name} files`}
      virtualized
      expandedIds={project.expandedIds}
      getItemTitle={(item) =>
        item.type === "entry"
          ? item.entry.path
          : item.type === "error"
            ? item.message
            : "Load more files"}
      getItemSelected={(item) => itemPath(item) === activeRelativePath}
      onItemActivate={activate}
      onItemExpansionChange={(item, expanded) =>
        setFileExplorerItemExpanded(activeProject.id, item, expanded)}
    >
      {#snippet itemLeading(item)}
        {#if item.type === "entry"}
          {#if item.entry.symlink}
            <Link class="size-3.5" aria-hidden="true" />
          {:else if item.entry.kind === "directory"}
            {#if project.expandedIds.has(fileExplorerEntryNodeId(activeProject.id, item.entry.path))}
              <FolderOpen class="size-3.5" aria-hidden="true" />
            {:else}
              <Folder class="size-3.5" aria-hidden="true" />
            {/if}
          {:else}
            <File class="size-3.5" aria-hidden="true" />
          {/if}
          {#if item.entry.kind === "directory" && project.directories[item.entry.path]?.loading}
            <Spinner class="ml-0.5 size-3" />
          {/if}
        {:else if item.type === "error"}
          <TriangleAlert class="size-3.5 text-destructive" aria-hidden="true" />
        {/if}
      {/snippet}
    </PanelTree>
  {/if}
</PanelView>
