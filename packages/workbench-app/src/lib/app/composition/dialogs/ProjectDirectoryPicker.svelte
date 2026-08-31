<script lang="ts">
import { untrack } from "svelte";
import { SvelteSet } from "svelte/reactivity";
import FolderSearch from "@lucide/svelte/icons/folder-search";
import { writeClipboardText } from "$lib/platform/clipboard/write-text";
import { notify } from "$lib/application/notifications/notify.svelte";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";
import {
  listDirectories,
  type FilesystemDirectoryResponse,
  type ProjectRecord,
} from "$lib/api";
import { queryClient, queryKeys } from "$lib/platform/query/client";
import { discoverGitRepos, GIT_STALE_MS } from "$lib/features/git";
import { looksLikePath, pathKey } from "$lib/domain/filesystem/project-path";
import DirectoryPickerFooter from "$lib/features/projects/views/DirectoryPickerFooter.svelte";
import DirectoryPickerList from "$lib/features/projects/views/DirectoryPickerList.svelte";
import DirectoryPickerSearch from "$lib/features/projects/views/DirectoryPickerSearch.svelte";
import RecentProjectsView from "$lib/features/projects/views/RecentProjectsView.svelte";
import {
  expandHome,
  signalMeta,
  uniqueSignals,
} from "$lib/features/projects/views/directory-picker-helpers";
import type {
  FilesystemEntry,
  NavItem,
} from "$lib/features/projects/views/directory-picker-types";
import type { ProjectSwitcherItem } from "$lib/features/projects/state/project-switcher";
import {
  summarizeProjectGit,
  type ProjectGitOverview,
} from "$lib/features/projects/state/project-overview";
type Props = {
  open?: boolean;
  projects?: ProjectRecord[];
  switcherItems?: ProjectSwitcherItem[];
  activeProjectKey?: string;
  homeDir?: string;
  onClose?: () => void;
  onSelectProject?: (projectId: string) => void | Promise<void>;
  onOpenDirectory?: (path: string) => void | Promise<void>;
  onNewChat?: (path: string) => void | Promise<void>;
  onForget?: (projectId: string) => void;
};
let {
  open = $bindable(false),
  projects = [],
  switcherItems = [],
  activeProjectKey,
  homeDir,
  onClose,
  onSelectProject,
  onOpenDirectory,
  onNewChat,
  onForget,
}: Props = $props();
type Mode = "recent" | "browse";
let mode = $state<Mode>("recent");
let query = $state("");
let listing = $state<FilesystemDirectoryResponse | undefined>(undefined);
let loading = $state(false);
let error = $state<string | undefined>(undefined);
let showHidden = $state(false);
let selectedIndex = $state(-1);
let recentSelectedIndex = $state(-1);
let wasOpen = $state(false);
let previousShowHidden = $state(false);
let listEl = $state<HTMLDivElement | undefined>(undefined);
let recentScrollEl = $state<HTMLDivElement | undefined>(undefined);
let gitByProjectKey = $state<Record<string, ProjectGitOverview>>({});
let gitLoadingByProjectKey = $state<Record<string, boolean>>({});
let gitErrorByProjectKey = $state<Record<string, boolean>>({});
let gitLoadGeneration = 0;
const gitInFlightProjectKeys = new SvelteSet<string>();
const openedProjectKeys = $derived.by(
  () => new Set(projects.map((project) => pathKey(project.dir))),
);
const MAX_RECENT_PROJECTS = 100;
const recentProjects = $derived(switcherItems.slice(0, MAX_RECENT_PROJECTS));
const pathQuery = $derived(looksLikePath(query.trim()));
const filteredRecents = $derived.by(() => {
  if (pathQuery) return [];
  const q = query.trim().toLowerCase();
  if (!q) return recentProjects;
  return recentProjects.filter(
    (item) =>
      item.label.toLowerCase().includes(q) ||
      item.project.name.toLowerCase().includes(q) ||
      item.project.dir.toLowerCase().includes(q),
  );
});
const recentActiveDescendant = $derived(
  recentSelectedIndex >= 0 && filteredRecents[recentSelectedIndex]
    ? `recent:${encodeURIComponent(filteredRecents[recentSelectedIndex].key)}`
    : undefined,
);
const filteredEntries = $derived.by(() => {
  const entries = listing?.entries ?? [];
  const q = query.trim();
  if (!q || looksLikePath(q)) return entries;
  const lower = q.toLowerCase();
  return entries.filter((entry) => entry.name.toLowerCase().includes(lower));
});
const navItems = $derived.by<NavItem[]>(() =>
  filteredEntries.map((entry) => ({
    kind: "folder",
    id: `folder:${entry.path}`,
    path: entry.path,
    entry,
  })),
);
const selectedItem = $derived<NavItem | undefined>(
  selectedIndex >= 0 ? navItems[selectedIndex] : undefined,
);
const selectedFolder = $derived<FilesystemEntry | undefined>(
  selectedItem?.entry,
);
const openTargetPath = $derived(selectedItem?.path ?? listing?.path ?? "");
const openTargetSignals = $derived(
  uniqueSignals(
    selectedFolder?.signals ?? (selectedItem ? [] : listing?.signals),
  ),
);
const activeDescendant = $derived(selectedItem?.id);
function isOpened(path: string): boolean {
  return openedProjectKeys.has(pathKey(path));
}
async function load(path?: string) {
  loading = true;
  error = undefined;
  try {
    listing = await listDirectories(path, showHidden);
    query = "";
    selectedIndex = -1;
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  } finally {
    loading = false;
  }
}
function reloadCurrent() {
  void load(listing?.path || undefined);
}
function scrollActiveIntoView() {
  requestAnimationFrame(() => {
    listEl
      ?.querySelector(".row.selected")
      ?.scrollIntoView({ block: "nearest" });
  });
}
function scrollRecentIntoView() {
  requestAnimationFrame(() => {
    recentScrollEl
      ?.querySelector('[role="option"][aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  });
}
function resetRecentSelection() {
  recentSelectedIndex = -1;
}
function enterBrowse(path?: string) {
  mode = "browse";
  query = "";
  selectedIndex = -1;
  if (path) void load(path);
  else if (!listing) void load(homeDir || undefined);
}
function enterRecent() {
  mode = "recent";
  query = "";
  recentSelectedIndex = -1;
}
function handleOpenChange(next: boolean) {
  open = next;
  if (!next) onClose?.();
}
async function chooseProject(projectId: string) {
  await onSelectProject?.(projectId);
  handleOpenChange(false);
}

function handleSubmit(event: Event) {
  event.preventDefault();
  const q = query.trim();
  if (!q) return;
  if (looksLikePath(q)) {
    enterBrowse(expandHome(q, homeDir));
    return;
  }
  if (mode === "recent") {
    const target =
      filteredRecents[recentSelectedIndex >= 0 ? recentSelectedIndex : 0];
    if (target) void chooseProject(target.project.id);
    return;
  }
  const first = navItems[0];
  if (first) void load(first.path);
}
async function openTarget() {
  const path = openTargetPath;
  if (!path) return;
  await onOpenDirectory?.(path);
  handleOpenChange(false);
}
function handleFolderRowKeydown(
  event: KeyboardEvent,
  index: number,
  item: NavItem,
) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    event.stopPropagation();
    selectedIndex = index;
    void load(item.path);
  }
}
function handleRecentRowKeydown(
  event: KeyboardEvent,
  index: number,
  item: ProjectSwitcherItem,
) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    event.stopPropagation();
    recentSelectedIndex = index;
    void chooseProject(item.project.id);
  }
}
async function copyPath(path: string) {
  try {
    await writeClipboardText(path);
    notify.success("Path copied");
  } catch {
    notify.error("Could not copy to clipboard");
  }
}
async function loadRecentGit(items: ProjectSwitcherItem[], generation: number) {
  let nextIndex = 0;
  async function worker() {
    while (generation === gitLoadGeneration && open && mode === "recent") {
      const item = items[nextIndex++];
      if (!item) return;
      if (
        gitByProjectKey[item.key] ||
        gitErrorByProjectKey[item.key] ||
        gitInFlightProjectKeys.has(item.key)
      ) {
        continue;
      }

      gitInFlightProjectKeys.add(item.key);
      gitLoadingByProjectKey[item.key] = true;
      try {
        const discovery = await queryClient.fetchQuery({
          queryKey: queryKeys.git.repos(item.project.id),
          queryFn: () => discoverGitRepos(item.project.id),
          staleTime: GIT_STALE_MS,
        });
        gitByProjectKey[item.key] = summarizeProjectGit(discovery);
      } catch {
        if (!gitByProjectKey[item.key]) gitErrorByProjectKey[item.key] = true;
      } finally {
        gitInFlightProjectKeys.delete(item.key);
        gitLoadingByProjectKey[item.key] = false;
      }
    }
  }

  await Promise.all(Array.from({ length: 4 }, () => worker()));
}
function handleRecentKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  const inInput = target?.tagName === "INPUT";
  const count = filteredRecents.length;
  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      if (count) {
        recentSelectedIndex =
          recentSelectedIndex < 0
            ? 0
            : Math.min(recentSelectedIndex + 1, count - 1);
        scrollRecentIntoView();
      }
      break;
    case "ArrowUp":
      event.preventDefault();
      if (count) {
        recentSelectedIndex = Math.max(0, recentSelectedIndex - 1);
        scrollRecentIntoView();
      }
      break;
    case "Enter":
      if (inInput) return;
      event.preventDefault();
      if (pathQuery) {
        enterBrowse(expandHome(query, homeDir));
        return;
      }
      {
        const target2 =
          filteredRecents[recentSelectedIndex >= 0 ? recentSelectedIndex : 0];
        if (target2) void chooseProject(target2.project.id);
      }
      break;
  }
}
function handleBrowseKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  const inInput = target?.tagName === "INPUT";
  const count = navItems.length;
  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      if (count) {
        selectedIndex =
          selectedIndex < 0 ? 0 : Math.min(selectedIndex + 1, count - 1);
        scrollActiveIntoView();
      }
      break;
    case "ArrowUp":
      event.preventDefault();
      if (count) {
        selectedIndex = selectedIndex <= 0 ? 0 : selectedIndex - 1;
        scrollActiveIntoView();
      }
      break;
    case "ArrowRight":
      if (!inInput && selectedFolder) {
        event.preventDefault();
        void load(selectedFolder.path);
      }
      break;
    case "Enter":
      if (event.metaKey || event.ctrlKey) {
        event.preventDefault();
        void openTarget();
      } else if (!inInput && selectedItem) {
        event.preventDefault();
        void load(selectedItem.path);
      }
      break;
    case "ArrowLeft":
      if (!inInput && listing?.parent) {
        event.preventDefault();
        void load(listing.parent);
      }
      break;
    case "Backspace":
      if (query.length === 0 && listing?.parent) {
        event.preventDefault();
        void load(listing.parent);
      }
      break;
  }
}
function handleKeydown(event: KeyboardEvent) {
  if (mode === "recent") handleRecentKeydown(event);
  else handleBrowseKeydown(event);
}
$effect(() => {
  const items = open && mode === "recent" ? filteredRecents : [];
  const generation = ++gitLoadGeneration;
  if (!items.length || typeof window === "undefined") return;
  untrack(() => void loadRecentGit(items, generation));
});
$effect(() => {
  if (open && !wasOpen) {
    mode = recentProjects.length ? "recent" : "browse";
    recentSelectedIndex = -1;
    selectedIndex = -1;
    query = "";
    gitByProjectKey = {};
    gitErrorByProjectKey = {};
    void load(listing?.path || undefined);
  }
  wasOpen = open;
});
$effect(() => {
  if (open && showHidden !== previousShowHidden) reloadCurrent();
  previousShowHidden = showHidden;
});
</script>

{#snippet recentFooter()}
  <Button
    variant="outline"
    size="sm"
    data-tour-id="guide-project-browse"
    onclick={() => enterBrowse()}
  >
    <FolderSearch size={14} strokeWidth={2.2} />
    Browse
  </Button>
{/snippet}

{#snippet browseFooter()}
  <DirectoryPickerFooter
    path={openTargetPath}
    {homeDir}
    signals={openTargetSignals}
    {signalMeta}
    {loading}
    onOpen={() => void openTarget()}
  />
{/snippet}

<Dialog
  flush
  bind:open
  title={mode === "recent" ? "Projects" : "Open Project"}
  description={mode === "recent"
    ? "Choose a recent project or browse for a folder."
    : "Choose a folder to open as a project."}
  class={`project-picker-dialog ${mode === "recent" ? "project-picker-dialog-recent" : ""}`}
  footer={mode === "recent" ? recentFooter : browseFooter}
  onOpenChange={handleOpenChange}
>
  <div
    class={`grid h-full min-h-0 ${
      mode === "recent" || !error
        ? "grid-rows-[auto_minmax(0,1fr)]"
        : "grid-rows-[auto_auto_minmax(0,1fr)]"
    }`}
    role="presentation"
    onkeydown={handleKeydown}
  >
    {#if mode === "recent"}
      <RecentProjectsView
        bind:scrollEl={recentScrollEl}
        items={filteredRecents}
        totalRecentCount={recentProjects.length}
        bind:query
        {pathQuery}
        selectedIndex={recentSelectedIndex}
        activeDescendant={recentActiveDescendant}
        {activeProjectKey}
        {homeDir}
        {loading}
        {gitByProjectKey}
        {gitLoadingByProjectKey}
        {gitErrorByProjectKey}
        onOpen={(item) => void chooseProject(item.project.id)}
        onNewChat={(path) => void onNewChat?.(path)}
        onCopyPath={(path) => void copyPath(path)}
        {onForget}
        onBrowsePath={() => enterBrowse(expandHome(query, homeDir))}
        onQueryChange={resetRecentSelection}
        onSubmit={handleSubmit}
        onRowKeydown={handleRecentRowKeydown}
      />
    {:else}
      <DirectoryPickerSearch
        {loading}
        parent={listing?.parent}
        bind:query
        bind:showHidden
        onLoad={(path) => void load(path)}
        onReload={reloadCurrent}
        onQueryChange={() => (selectedIndex = -1)}
        onSubmit={handleSubmit}
        onBack={recentProjects.length ? enterRecent : undefined}
      />
      {#if error}
        <p class="m-0 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      {/if}
      <DirectoryPickerList
        bind:listEl
        {filteredEntries}
        {loading}
        {query}
        {selectedIndex}
        {selectedItem}
        {activeDescendant}
        {signalMeta}
        {isOpened}
        {uniqueSignals}
        load={(path) => void load(path)}
        onSelectedIndexChange={(index) => (selectedIndex = index)}
        onRowKeydown={handleFolderRowKeydown}
      />
    {/if}
  </div>
</Dialog>

<style>
/* DialogShell portals its content, so the picker's geometry has to be declared
 * globally on the shell's own element (escape-hatch reason 5). The compound
 * selector keeps it ahead of `.dialog-content`'s default width. */
:global(.dialog-content.project-picker-dialog) {
  width: min(720px, calc(100vw - 24px));
  width: min(720px, calc(100dvw - 1.5rem));
  height: min(680px, calc(100vh - 48px));
  height: min(680px, calc(100dvh - 3rem));
  min-height: min(480px, calc(100vh - 48px));
  min-height: min(480px, calc(100dvh - 3rem));
  max-height: min(680px, calc(100vh - 48px));
  max-height: min(680px, calc(100dvh - 3rem));
}

:global(.dialog-content.project-picker-dialog.project-picker-dialog-recent) {
  height: auto;
  max-height: min(640px, calc(100vh - 48px));
  max-height: min(640px, calc(100dvh - 3rem));
}

@media (max-width: 560px) {
  :global(.dialog-content.project-picker-dialog) {
    width: calc(100vw - 12px);
    width: calc(100dvw - 0.75rem);
    height: calc(100vh - 12px);
    height: calc(100dvh - 0.75rem);
    max-height: calc(100vh - 12px);
    max-height: calc(100dvh - 0.75rem);
  }

  :global(.dialog-content.project-picker-dialog.project-picker-dialog-recent) {
    height: auto;
    max-height: calc(100vh - 12px);
    max-height: calc(100dvh - 0.75rem);
  }
}
</style>
