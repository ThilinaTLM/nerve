<script lang="ts">
  import { writeClipboardText } from "$lib/core/clipboard";
  import { notify } from "$lib/features/notifications/notify.svelte";
  import Dialog from "$lib/components/ui/dialog-shell";
  import {
    listDirectories,
    type FilesystemDirectoryResponse,
    type ProjectRecord,
    type ConversationRecord,
  } from "$lib/api";
  import {
    looksLikePath,
    pathBreadcrumbs,
    pathKey,
  } from "$lib/core/utils/path";
  import DirectoryPickerFooter from "./DirectoryPickerFooter.svelte";
  import DirectoryPickerList from "./DirectoryPickerList.svelte";
  import DirectoryPickerSearch from "./DirectoryPickerSearch.svelte";
  import { expandHome, signalMeta, uniqueSignals } from "./directory-picker-helpers";
  import type { FilesystemEntry, NavItem } from "./directory-picker-types";
  import "./project-directory-picker.css";
  type Props = {
    open?: boolean;
    projects?: ProjectRecord[];
    conversations?: ConversationRecord[];
    homeDir?: string;
    onClose?: () => void;
    onSelect?: (path: string) => void | Promise<void>;
    onForget?: (projectId: string) => void;
  };
  let {
    open = $bindable(false),
    projects = [],
    conversations = [],
    homeDir,
    onClose,
    onSelect,
    onForget,
  }: Props = $props();
  let query = $state("");
  let listing = $state<FilesystemDirectoryResponse | undefined>(undefined);
  let loading = $state(false);
  let error = $state<string | undefined>(undefined);
  let showHidden = $state(false);
  let selectedIndex = $state(-1);
  let wasOpen = $state(false);
  let previousShowHidden = $state(false);
  let listEl = $state<HTMLDivElement | undefined>(undefined);
  const openedProjectKeys = $derived.by(() => new Set(projects.map((project) => pathKey(project.dir))));
  const conversationCounts = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const conversation of conversations) {
      counts.set(conversation.projectId, (counts.get(conversation.projectId) ?? 0) + 1);
    }
    return counts;
  });
  const recentProjects = $derived.by(() => {
    const seen = new Set<string>();
    return [...projects]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .filter((project) => {
        const key = pathKey(project.dir);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 7);
  });
  const filteredEntries = $derived.by(() => {
    const entries = listing?.entries ?? [];
    const q = query.trim();
    if (!q || looksLikePath(q)) return entries;
    const lower = q.toLowerCase();
    return entries.filter((entry) => entry.name.toLowerCase().includes(lower));
  });
  const showRecent = $derived(recentProjects.length > 0 && !query.trim());
  const navItems = $derived.by<NavItem[]>(() => {
    const items: NavItem[] = [];
    if (showRecent) {
      for (const project of recentProjects) {
        items.push({ kind: "recent", id: `recent:${project.id}`, path: project.dir, project });
      }
    }
    for (const entry of filteredEntries) {
      items.push({ kind: "folder", id: `folder:${entry.path}`, path: entry.path, entry });
    }
    return items;
  });
  const recentCount = $derived(showRecent ? recentProjects.length : 0);
  const selectedItem = $derived<NavItem | undefined>(
    selectedIndex >= 0 ? navItems[selectedIndex] : undefined,
  );
  const selectedFolder = $derived<FilesystemEntry | undefined>(
    selectedItem?.kind === "folder" ? selectedItem.entry : undefined,
  );
  const openTargetPath = $derived(selectedItem?.path ?? listing?.path ?? "");
  const openTargetSignals = $derived(
    uniqueSignals(selectedFolder?.signals ?? (selectedItem ? [] : listing?.signals)),
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
      listEl?.querySelector(".row.selected")?.scrollIntoView({ block: "nearest" });
    });
  }
  function handleOpenChange(next: boolean) {
    open = next;
    if (!next) onClose?.();
  }
  function handleSubmit(event: Event) {
    event.preventDefault();
    const q = query.trim();
    if (!q) return;
    if (looksLikePath(q)) {
      void load(expandHome(q, homeDir));
      return;
    }
    const first = navItems.find((item) => item.kind === "folder");
    if (first) void load(first.path);
  }
  async function openTarget() {
    const path = openTargetPath;
    if (!path) return;
    await onSelect?.(path);
  }
  /** Commit a nav item: recents open immediately, folders drill in. */
  function activateItem(item: NavItem) {
    if (item.kind === "recent") void onSelect?.(item.path);
    else void load(item.path);
  }
  function handleRowKeydown(event: KeyboardEvent, index: number, item: NavItem) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectedIndex = index;
      activateItem(item);
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
  function handleKeydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    const inInput = target?.tagName === "INPUT";
    const count = navItems.length;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (count) {
          selectedIndex = selectedIndex < 0 ? 0 : Math.min(selectedIndex + 1, count - 1);
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
          activateItem(selectedItem);
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
  $effect(() => {
    if (open && !wasOpen) void load(listing?.path || undefined);
    wasOpen = open;
  });
  $effect(() => {
    if (open && showHidden !== previousShowHidden) reloadCurrent();
    previousShowHidden = showHidden;
  });
  import "./project-directory-picker.css";
</script>
<Dialog
  bind:open
  title="Open Project"
  class="project-picker-dialog"
  onOpenChange={handleOpenChange}
>
  <div class="picker-body" role="presentation" onkeydown={handleKeydown}>
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
    />
    {#if error}
      <p class="picker-error">{error}</p>
    {/if}
    <DirectoryPickerList
      bind:listEl
      {showRecent}
      {recentProjects}
      {filteredEntries}
      {loading}
      {query}
      {selectedIndex}
      {selectedItem}
      {activeDescendant}
      {recentCount}
      {signalMeta}
      {homeDir}
      {isOpened}
      {conversationCountFor}
      {uniqueSignals}
      load={(path) => void load(path)}
      copyPath={(path) => void copyPath(path)}
      {onSelect}
      {onForget}
      onSelectedIndexChange={(index) => (selectedIndex = index)}
      onRowKeydown={handleRowKeydown}
    />
  </div>
  {#snippet footer()}
    <DirectoryPickerFooter
      path={openTargetPath}
      {homeDir}
      signals={openTargetSignals}
      {signalMeta}
      {loading}
      onOpen={() => void openTarget()}
    />
  {/snippet}
</Dialog>
