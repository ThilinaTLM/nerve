<script lang="ts">
import { untrack } from "svelte";
import File from "@lucide/svelte/icons/file";
import Folder from "@lucide/svelte/icons/folder";
import FolderSymlink from "@lucide/svelte/icons/folder-symlink";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import type { FilesystemProjectEntry } from "@nervekit/contracts/filesystem";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import {
  MobileListRow,
  MobileScreen,
  MobileSection,
} from "$lib/presentation/shell";
import { openFilePane } from "$lib/features/filesystem";
import { fileExplorerState } from "$lib/features/filesystem/state/file-explorer-state.svelte";
import { loadFileExplorerDirectory } from "$lib/features/filesystem/state/file-explorer-actions.svelte";
import { workspaceSelectors } from "$lib/application/workspace";
import { openMobileCenter } from "$lib/app/shell/mobile/mobile-route-activation.svelte";
import {
  backFromMobileScreen,
  pushMobileScreen,
} from "$lib/app/shell/mobile/mobile-shell.svelte";
import type { MobileScreenProps } from "./mobile-screen-registry";

/**
 * One directory per screen: drilling into a folder pushes the next level, so
 * the system back gesture walks back up the tree. Shares the desktop explorer's
 * directory cache, so both shells stay in sync.
 */
let { route }: MobileScreenProps<"files"> = $props();

const projectId = $derived(route.projectId);
const path = $derived(route.path);
const project = $derived(
  workspaceSelectors.projects.find((candidate) => candidate.id === projectId),
);
const directory = $derived(
  fileExplorerState.projects[projectId]?.directories[path],
);
const entries = $derived(
  (directory?.entries ?? []).toSorted((left, right) => {
    const folder =
      Number(right.kind === "directory") - Number(left.kind === "directory");
    return folder || left.name.localeCompare(right.name);
  }),
);
const title = $derived(
  path ? (path.split("/").at(-1) ?? path) : (project?.name ?? "Files"),
);

// Load once per directory; the cache may already hold it from the desktop.
$effect(() => {
  const target = { projectId, path };
  untrack(() => {
    const current =
      fileExplorerState.projects[target.projectId]?.directories[target.path];
    if (current && !current.error && current.pagesLoaded > 0) return;
    void loadFileExplorerDirectory(target.projectId, target.path);
  });
});

function icon(entry: FilesystemProjectEntry) {
  if (entry.kind !== "directory") return File;
  return entry.symlink ? FolderSymlink : Folder;
}

function open(entry: FilesystemProjectEntry) {
  if (entry.kind === "directory") {
    pushMobileScreen({ kind: "files", projectId, path: entry.path });
    return;
  }
  void openMobileCenter("file", () =>
    openFilePane({ projectId, path: entry.path }),
  );
}
</script>

<MobileScreen
  {title}
  subtitle={path ? `${project?.name ?? ""}/${path}` : "Project root"}
  onBack={backFromMobileScreen}
  backLabel="Back"
>
  {#snippet actions()}
    <Button
      variant="ghost"
      size="icon-sm"
      ariaLabel="Refresh"
      disabled={directory?.loading || directory?.refreshing}
      onclick={() =>
        void loadFileExplorerDirectory(projectId, path, { refresh: true })}
    >
      <RefreshCw size={17} strokeWidth={1.9} />
    </Button>
  {/snippet}

  {#if directory?.error}
    <p class="px-6 py-4 text-sm text-destructive">{directory.error}</p>
  {/if}

  {#if entries.length}
    <MobileSection>
      {#each entries as entry (entry.path)}
        <MobileListRow
          title={entry.name}
          icon={icon(entry)}
          chevron={entry.kind === "directory"}
          onclick={() => open(entry)}
        />
      {/each}
    </MobileSection>
    {#if directory?.nextCursor}
      <div class="flex justify-center px-3 py-2">
        <Button
          variant="outline"
          size="sm"
          disabled={directory.loading}
          onclick={() =>
            void loadFileExplorerDirectory(projectId, path, { append: true })}
        >
          Load more
        </Button>
      </div>
    {/if}
  {:else if directory?.loading || !directory}
    <p class="px-6 py-10 text-center text-sm text-muted-foreground">Loading…</p>
  {:else if !directory.error}
    <p class="px-6 py-10 text-center text-sm text-muted-foreground">
      This folder is empty.
    </p>
  {/if}
</MobileScreen>
