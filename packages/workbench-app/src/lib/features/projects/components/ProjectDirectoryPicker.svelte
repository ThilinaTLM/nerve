<script lang="ts">
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import FolderSearch from "@lucide/svelte/icons/folder-search";
import { writeClipboardText } from "$lib/core/clipboard";
import { notify } from "$lib/features/notifications/notify.svelte";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import Dialog from "@nervekit/ui-kit/components/ui/dialog-shell";
import {
  listDirectories,
  type FilesystemDirectoryResponse,
  type ProjectRecord,
  type ConversationRecord,
} from "$lib/api";
import { looksLikePath, pathBreadcrumbs, pathKey } from "$lib/core/utils/path";
import DirectoryPickerFooter from "./DirectoryPickerFooter.svelte";
import DirectoryPickerList from "./DirectoryPickerList.svelte";
import DirectoryPickerSearch from "./DirectoryPickerSearch.svelte";
import RecentProjectsView from "./RecentProjectsView.svelte";
import {
  expandHome,
  signalMeta,
  uniqueSignals,
} from "./directory-picker-helpers";
import type { FilesystemEntry, NavItem } from "./directory-picker-types";
import type {
  ProjectActivitySummary,
  ProjectSwitcherItem,
} from "$lib/features/projects/state/project-switcher";
type Props = {
  open?: boolean;
  projects?: ProjectRecord[];
  conversations?: ConversationRecord[];
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
  conversations = [],
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
const openedProjectKeys = $derived.by(
  () => new Set(projects.map((project) => pathKey(project.dir))),
);
const activityByProjectId = $derived.by(() => {
  const map = new SvelteMap<string, ProjectActivitySummary>();
  for (const item of switcherItems) {
    for (const id of item.projectIds) map.set(id, item.activity);
  }
  return map;
});
const currentProjectIds = $derived.by(() => {
  const active = switcherItems.find((item) => item.key === activeProjectKey);
  return new SvelteSet(active?.projectIds ?? []);
});
const lastAccessedByProjectId = $derived.by(() => {
  const map = new SvelteMap<string, number>();
  for (const item of switcherItems) {
    if (item.lastAccessedAt === undefined) continue;
    for (const id of item.projectIds) map.set(id, item.lastAccessedAt);
  }
  return map;
});
const conversationCounts = $derived.by(() => {
  const counts = new SvelteMap<string, number>();
  for (const conversation of conversations) {
    counts.set(
      conversation.projectId,
      (counts.get(conversation.projectId) ?? 0) + 1,
    );
  }
  return counts;
});
const recentProjects = $derived.by(() => {
  const seen = new SvelteSet<string>();
  return [...projects]
    .sort(
      (a, b) =>
        (lastAccessedByProjectId.get(b.id) ?? 0) -
          (lastAccessedByProjectId.get(a.id) ?? 0) ||
        b.updatedAt.localeCompare(a.updatedAt),
    )
    .filter((project) => {
      const key = pathKey(project.dir);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 24);
});
const pathQuery = $derived(looksLikePath(query.trim()));
const filteredRecents = $derived.by(() => {
  if (pathQuery) return [];
  const q = query.trim().toLowerCase();
  if (!q) return recentProjects;
  return recentProjects.filter(
    (project) =>
      project.name.toLowerCase().includes(q) ||
      project.dir.toLowerCase().includes(q),
  );
});
const recentActiveDescendant = $derived(
  recentSelectedIndex >= 0
    ? `recent:${filteredRecents[recentSelectedIndex]?.id}`
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
const crumbs = $derived(pathBreadcrumbs(listing?.path, homeDir));
function isOpened(path: string): boolean {
  return openedProjectKeys.has(pathKey(path));
}
function conversationCountFor(project: ProjectRecord): number {
  return conversationCounts.get(project.id) ?? 0;
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
    if (target) void chooseProject(target.id);
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
  project: ProjectRecord,
) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    event.stopPropagation();
    recentSelectedIndex = index;
    void chooseProject(project.id);
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
        recentSelectedIndex =
          recentSelectedIndex <= 0 ? 0 : recentSelectedIndex - 1;
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
        if (target2) void chooseProject(target2.id);
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
  if (open && !wasOpen) {
    mode = recentProjects.length ? "recent" : "browse";
    recentSelectedIndex = -1;
    selectedIndex = -1;
    query = "";
    void load(listing?.path || undefined);
  }
  wasOpen = open;
});
$effect(() => {
  if (open && showHidden !== previousShowHidden) reloadCurrent();
  previousShowHidden = showHidden;
});
</script>
<Dialog
  flush
  bind:open
  title="Projects"
  description="Choose a recent project or browse for a folder."
  class="project-picker-dialog"
  onOpenChange={handleOpenChange}
>
  {#snippet headerActions()}
    {#if mode === "recent"}
      <Button
        variant="outline"
        size="sm"
        data-tour-id="guide-project-browse"
        onclick={() => enterBrowse()}
      >
        <FolderSearch size={14} strokeWidth={2.2} />
        Open
      </Button>
    {/if}
  {/snippet}
  <div
    class={`grid h-full min-h-0 ${
      mode === "recent"
        ? "grid-rows-[auto_minmax(0,1fr)]"
        : "grid-rows-[auto_auto_minmax(0,1fr)]"
    }`}
    role="presentation"
    onkeydown={handleKeydown}
  >
    {#if mode === "recent"}
      <RecentProjectsView
        bind:scrollEl={recentScrollEl}
        recentProjects={filteredRecents}
        totalRecentCount={recentProjects.length}
        bind:query
        {pathQuery}
        selectedIndex={recentSelectedIndex}
        activeDescendant={recentActiveDescendant}
        {homeDir}
        {loading}
        {conversationCountFor}
        activityFor={(project) => activityByProjectId.get(project.id)}
        lastAccessedFor={(project) => lastAccessedByProjectId.get(project.id)}
        isCurrent={(project) => currentProjectIds.has(project.id)}
        onOpen={(project) => void chooseProject(project.id)}
        onNewChat={(path) => void onNewChat?.(path)}
        onCopyPath={(path) => void copyPath(path)}
        {onForget}
        onBrowsePath={() => enterBrowse(expandHome(query, homeDir))}
        onQueryChange={() => (recentSelectedIndex = -1)}
        onSubmit={handleSubmit}
        onRowKeydown={handleRecentRowKeydown}
      />
    {:else}
      <DirectoryPickerSearch
        {crumbs}
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
        <p
          class="m-0 border-b border-b-border/60 px-3 py-2 text-xs text-destructive"
        >
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
  {#snippet footer()}
    {#if mode === "recent"}
      <span class="flex-1 text-xs text-muted-foreground">
        {recentProjects.length} recent project{recentProjects.length === 1
          ? ""
          : "s"}
      </span>
    {:else}
      <DirectoryPickerFooter
        path={openTargetPath}
        {homeDir}
        signals={openTargetSignals}
        {signalMeta}
        {loading}
        onOpen={() => void openTarget()}
      />
    {/if}
  {/snippet}
</Dialog>

<style>
/* DialogShell portals its content, so the picker's geometry has to be declared
 * globally on the shell's own element (escape-hatch reason 5). The compound
 * selector keeps it ahead of `.dialog-content`'s default width. */
:global(.dialog-content.project-picker-dialog) {
  width: min(680px, calc(100vw - 24px));
  width: min(680px, calc(100dvw - 1.5rem));
  min-height: min(82vh, 520px);
  min-height: min(82dvh, 520px);
  max-height: min(82vh, 720px);
  max-height: min(82dvh, 720px);
}

@media (max-width: 560px) {
  :global(.dialog-content.project-picker-dialog) {
    width: calc(100vw - 12px);
    width: calc(100dvw - 0.75rem);
    max-height: calc(100vh - 12px);
    max-height: calc(100dvh - 0.75rem);
  }
}
</style>
