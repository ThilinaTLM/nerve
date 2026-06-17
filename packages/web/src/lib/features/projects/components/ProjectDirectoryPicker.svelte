<script lang="ts">
  import CheckCircle2 from "@lucide/svelte/icons/check-circle-2";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Copy from "@lucide/svelte/icons/copy";
  import Folder from "@lucide/svelte/icons/folder";
  import FolderClock from "@lucide/svelte/icons/folder-clock";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import GitBranch from "@lucide/svelte/icons/git-branch";
  import MoreHorizontal from "@lucide/svelte/icons/more-horizontal";
  import MoveUp from "@lucide/svelte/icons/move-up";
  import PackageIcon from "@lucide/svelte/icons/package";
  import Plus from "@lucide/svelte/icons/plus";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Search from "@lucide/svelte/icons/search";
  import Terminal from "@lucide/svelte/icons/terminal";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import { writeClipboardText } from "$lib/clipboard";
  import { notify } from "$lib/features/notifications/notify.svelte";
  import { Badge } from "$lib/components/ui/badge";
  import { Button, buttonVariants } from "$lib/components/ui/button";
  import Dialog from "$lib/components/ui/dialog-shell";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { Input } from "$lib/components/ui/input";
  import Switch from "$lib/components/ui/switch-field";
  import {
    listDirectories,
    type FilesystemDirectoryResponse,
    type FilesystemSignal,
    type ProjectRecord,
    type ConversationRecord,
  } from "$lib/api";
  import {
    looksLikePath,
    pathBreadcrumbs,
    pathKey,
    shortenPath,
    tildePath,
    type PathCrumb,
  } from "$lib/utils/path";
  import { dateTimeLabel, relativeTimeLabel } from "$lib/utils/time";

  type Props = {
    open?: boolean;
    projects?: ProjectRecord[];
    conversations?: ConversationRecord[];
    homeDir?: string;
    onClose?: () => void;
    onSelect?: (path: string) => void | Promise<void>;
    onForget?: (projectId: string) => void;
  };

  type SignalMeta = {
    label: string;
    title: string;
    tone?: "neutral" | "accent" | "good" | "warn" | "danger" | "running";
    icon: typeof GitBranch;
  };

  type FilesystemEntry = FilesystemDirectoryResponse["entries"][number];
  type NavItem =
    | { kind: "recent"; id: string; path: string; project: ProjectRecord }
    | { kind: "folder"; id: string; path: string; entry: FilesystemEntry };

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

  const signalMeta: Record<FilesystemSignal, SignalMeta> = {
    git: { label: "Git", title: "Git repository", tone: "accent", icon: GitBranch },
    package: { label: "Pkg", title: "JavaScript package", icon: PackageIcon },
    workspace: { label: "Workspace", title: "Workspace marker", tone: "accent", icon: PackageIcon },
    python: { label: "Py", title: "Python project", icon: Terminal },
    rust: { label: "Rust", title: "Rust project", icon: Terminal },
    go: { label: "Go", title: "Go module", icon: Terminal },
  };

  function uniqueSignals(signals: FilesystemSignal[] | undefined): FilesystemSignal[] {
    return [...new Set(signals ?? [])];
  }

  function expandHome(value: string): string {
    const v = value.trim();
    if (!homeDir) return v;
    if (v === "~") return homeDir;
    if (v.startsWith("~/") || v.startsWith("~\\")) {
      const sep = homeDir.includes("\\") ? "\\" : "/";
      return `${homeDir.replace(/[\\/]+$/, "")}${sep}${v.slice(2)}`;
    }
    return v;
  }

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
  const crumbs = $derived<PathCrumb[]>(pathBreadcrumbs(listing?.path, homeDir));

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
      void load(expandHome(q));
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
</script>

<Dialog
  bind:open
  title="Open Project"
  class="project-picker-dialog"
  onOpenChange={handleOpenChange}
>
  <div class="picker-body" role="presentation" onkeydown={handleKeydown}>
    <div class="path-bar">
      <nav class="crumbs" aria-label="Current location">
        {#each crumbs as crumb, i}
          {#if i > 0}<ChevronRight class="crumb-sep" size={13} strokeWidth={2.2} aria-hidden="true" />{/if}
          {#if i === crumbs.length - 1}
            <span class="crumb current" title={crumb.path}>{crumb.label}</span>
          {:else}
            <button class="crumb app-interactive-row" type="button" title={crumb.path} disabled={loading} onclick={() => void load(crumb.path)}>
              {crumb.label}
            </button>
          {/if}
        {/each}
      </nav>
      <div class="path-tools">
        <Button variant="ghost" size="icon-sm" disabled={!listing?.parent || loading} title="Parent directory" ariaLabel="Parent directory" onclick={() => void load(listing?.parent)}>
          <MoveUp size={14} strokeWidth={2.2} />
        </Button>
        <Button variant="ghost" size="icon-sm" disabled={loading} title="Refresh" ariaLabel="Refresh" onclick={reloadCurrent}>
          <RefreshCw size={14} strokeWidth={2.2} />
        </Button>
        <span class="path-tools-sep" aria-hidden="true"></span>
        <Switch bind:checked={showHidden} label="Hidden" class="hidden-switch" />
      </div>
    </div>
    <form class="picker-search" onsubmit={handleSubmit}>
      <Search size={14} strokeWidth={2.2} aria-hidden="true" />
      <Input
        bind:value={query}
        oninput={() => (selectedIndex = -1)}
        placeholder="Filter folders or paste a path"
        disabled={loading}
        size="sm"
        ariaLabel="Filter folders or enter a path"
      />
    </form>

    {#if error}
      <p class="picker-error">{error}</p>
    {/if}

    <div class="picker-scroll" bind:this={listEl}>
      {#if showRecent}
        <section class="group">
          <header class="group-head"><span>Recent</span></header>
          <div class="rows" role="listbox" aria-label="Recent projects" tabindex={-1} aria-activedescendant={selectedItem?.kind === "recent" ? activeDescendant : undefined}>
            {#each recentProjects as project, ri}
              {@const idx = ri}
              <div
                id={`recent:${project.id}`}
                class="row recent-row app-interactive-row"
                class:selected={selectedIndex === idx}
                role="option"
                aria-selected={selectedIndex === idx}
                tabindex="-1"
                title={`${project.dir}\n${dateTimeLabel(project.updatedAt)}`}
                onclick={() => (selectedIndex = idx)}
                ondblclick={() => void onSelect?.(project.dir)}
                onkeydown={(e) => handleRowKeydown(e, idx, { kind: "recent", id: `recent:${project.id}`, path: project.dir, project })}
              >
                <FolderClock size={16} strokeWidth={2.05} aria-hidden="true" />
                <span class="row-main">
                  <span class="row-title">
                    <strong>{project.name}</strong>
                    <small class="row-sub">{conversationCountFor(project)} chats · {relativeTimeLabel(project.updatedAt)}</small>
                  </span>
                  <small class="row-path">{tildePath(project.dir, homeDir)}</small>
                </span>
                <span class="row-actions">
                  <button class="row-open" type="button" title="Open project" onclick={(e) => { e.stopPropagation(); void onSelect?.(project.dir); }}>
                    <FolderOpen size={13} strokeWidth={2.2} />Open
                  </button>
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger
                      class={buttonVariants({ variant: "ghost", size: "icon-xs" })}
                      title="Project actions"
                      aria-label="Project actions"
                      onclick={(e: MouseEvent) => e.stopPropagation()}
                    >
                      <MoreHorizontal size={15} strokeWidth={2} />
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content align="end" class="w-44">
                      <DropdownMenu.Item onSelect={() => void onSelect?.(project.dir)}>
                        <Plus />
                        <span>New chat</span>
                      </DropdownMenu.Item>
                      <DropdownMenu.Item onSelect={() => void copyPath(project.dir)}>
                        <Copy />
                        <span>Copy path</span>
                      </DropdownMenu.Item>
                      {#if onForget}
                        <DropdownMenu.Separator />
                        <DropdownMenu.Item variant="destructive" onSelect={() => onForget?.(project.id)}>
                          <Trash2 />
                          <span>Forget project</span>
                        </DropdownMenu.Item>
                      {/if}
                    </DropdownMenu.Content>
                  </DropdownMenu.Root>
                </span>
              </div>
            {/each}
          </div>
        </section>
      {/if}

      <section class="group">
        <header class="group-head">
          <span>Folders</span>
          {#if !loading && filteredEntries.length}<span class="group-count">{filteredEntries.length}</span>{/if}
        </header>

        {#if loading}
          <div class="rows" aria-label="Loading directories">
            {#each Array.from({ length: 7 }) as _}
              <span class="skeleton-row"></span>
            {/each}
          </div>
        {:else if filteredEntries.length}
          <div class="rows" role="listbox" aria-label="Folders" tabindex={-1} aria-activedescendant={selectedItem?.kind === "folder" ? activeDescendant : undefined}>
            {#each filteredEntries as entry, fi}
              {@const idx = recentCount + fi}
              <div
                id={`folder:${entry.path}`}
                class="row folder-row app-interactive-row"
                class:selected={selectedIndex === idx}
                role="option"
                aria-selected={selectedIndex === idx}
                tabindex="-1"
                title={entry.path}
                onclick={() => (selectedIndex = idx)}
                ondblclick={() => void load(entry.path)}
                onkeydown={(e) => handleRowKeydown(e, idx, { kind: "folder", id: `folder:${entry.path}`, path: entry.path, entry })}
              >
                <Folder size={15} strokeWidth={2.1} aria-hidden="true" />
                <span class="row-main"><strong>{entry.name}</strong></span>
                <span class="row-badges">
                  {#if isOpened(entry.path)}
                    <Badge tone="good" size="xs"><CheckCircle2 size={11} />Opened</Badge>
                  {/if}
                  {#each uniqueSignals(entry.signals) as signal}
                    {@const meta = signalMeta[signal]}
                    {@const Icon = meta.icon}
                    <Badge tone={meta.tone ?? "neutral"} size="xs" title={meta.title}>
                      <Icon size={11} strokeWidth={2.2} />{meta.label}
                    </Badge>
                  {/each}
                  <button class="row-drill" type="button" title="Open folder" aria-label="Open folder" onclick={(e) => { e.stopPropagation(); void load(entry.path); }}>
                    <ChevronRight size={15} strokeWidth={2.2} aria-hidden="true" />
                  </button>
                </span>
              </div>
            {/each}
          </div>
        {:else}
          <div class="empty">
            <FolderOpen size={26} strokeWidth={1.8} />
            <p>{query.trim() ? "No folders match your filter." : "No subfolders here."}</p>
            <span>{query.trim() ? "Clear the filter or paste a path." : "Use Open below to choose this folder as the project."}</span>
          </div>
        {/if}
      </section>
    </div>
  </div>

  {#snippet footer()}
    <div class="footer-path" title={openTargetPath}>
      <FolderOpen size={14} strokeWidth={2.1} aria-hidden="true" />
      <span class="footer-path-text">{openTargetPath ? shortenPath(openTargetPath, homeDir) : "—"}</span>
      <span class="footer-signals">
        {#each openTargetSignals as signal}
          {@const meta = signalMeta[signal]}
          {@const Icon = meta.icon}
          <Badge tone={meta.tone ?? "neutral"} size="xs" title={meta.title}>
            <Icon size={11} strokeWidth={2.2} />{meta.label}
          </Badge>
        {/each}
      </span>
    </div>
    <div class="footer-actions">
      <Button
        class="footer-open-button"
        size="sm"
        disabled={!openTargetPath || loading}
        title={openTargetPath ? `Open ${openTargetPath}` : "Open"}
        onclick={() => void openTarget()}
      >
        <FolderOpen size={14} strokeWidth={2.2} />
        Open
      </Button>
    </div>
  {/snippet}
</Dialog>

<style>
  :global(.project-picker-dialog) {
    width: min(680px, calc(100vw - 24px));
    max-height: min(82vh, 720px);
  }

  :global(.project-picker-dialog .dialog-header) {
    gap: 0.6rem;
  }

  /* Path bar */
  .path-bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    border-bottom: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
    padding: 0.45rem 0.6rem 0.45rem 0.75rem;
  }

  .path-tools {
    display: flex;
    flex: none;
    align-items: center;
    gap: 0.3rem;
  }

  .path-tools-sep {
    width: 1px;
    height: 1.1rem;
    background: color-mix(in oklab, var(--border) 70%, transparent);
  }

  /* Breadcrumb */
  .crumbs {
    display: flex;
    min-width: 0;
    flex: 1;
    align-items: center;
    gap: 0.15rem;
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .crumb {
    max-width: 12rem;
    overflow: hidden;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    padding: 0.1rem 0.3rem;
    color: var(--muted-foreground);
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
    transition: color 120ms ease, background 120ms ease;
  }

  .crumb:hover:not(:disabled),
  .crumb:focus-visible {
    background: var(--accent);
    color: var(--foreground);
    outline: none;
  }

  .crumb.current {
    color: var(--foreground);
    font-weight: 500;
    cursor: default;
  }

  .crumbs :global(.crumb-sep) {
    flex: none;
    color: color-mix(in oklab, var(--muted-foreground) 55%, transparent);
  }

  /* Body */
  .picker-body {
    display: grid;
    min-height: 0;
    height: 100%;
    grid-template-rows: auto auto minmax(0, 1fr);
  }

  .picker-search {
    position: relative;
    display: grid;
    align-items: center;
    border-bottom: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
    padding: 0.6rem 0.75rem;
  }

  .picker-search :global(svg) {
    position: absolute;
    z-index: 1;
    top: 50%;
    left: 1.3rem;
    color: var(--muted-foreground);
    transform: translateY(-50%);
    pointer-events: none;
  }

  .picker-search :global([data-slot="input"]) {
    padding-left: 2rem;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .picker-error {
    margin: 0;
    border-bottom: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
    padding: 0.5rem 0.75rem;
    color: var(--destructive);
    font-size: var(--text-xs);
  }

  .picker-scroll {
    min-height: 0;
    overflow: auto;
    padding: 0.5rem;
  }

  .group + .group {
    margin-top: 0.5rem;
  }

  .group-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0.3rem 0.4rem;
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .group-count {
    margin-left: auto;
    color: var(--muted-foreground);
    font-variant-numeric: tabular-nums;
  }

  .rows {
    display: grid;
    gap: 0.12rem;
  }

  .row {
    position: relative;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    min-height: 2.25rem;
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: transparent;
    padding: 0.3rem 0.5rem;
    color: var(--foreground);
    text-align: left;
    cursor: pointer;
    transition: background 120ms ease, border-color 120ms ease;
  }

  .row > :global(svg) {
    flex: none;
    color: var(--muted-foreground);
  }

  .recent-row > :global(svg) {
    color: var(--primary);
  }

  .row-main {
    display: grid;
    min-width: 0;
    gap: 0.05rem;
  }

  .row-title {
    display: flex;
    min-width: 0;
    align-items: baseline;
    gap: 0.45rem;
  }

  .row-main strong {
    overflow: hidden;
    font-size: var(--text-sm);
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-sub {
    flex: none;
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    white-space: nowrap;
  }

  .row-path {
    overflow: hidden;
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-badges,
  .row-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.4rem;
  }

  /* Inline row actions */
  .row-open {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--card);
    padding: 0.1rem 0.4rem;
    color: var(--foreground);
    font-size: var(--text-xs);
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
    opacity: 0;
    transition: opacity 120ms ease, background 120ms ease, border-color 120ms ease;
  }

  .row-open:hover {
    border-color: var(--primary);
    background: var(--accent);
  }

  .row-drill {
    display: inline-grid;
    place-items: center;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    padding: 0.15rem;
    color: var(--muted-foreground);
    cursor: pointer;
    opacity: 0;
    transition: opacity 120ms ease, background 120ms ease, color 120ms ease;
  }

  .row-drill:hover {
    background: var(--accent);
    color: var(--foreground);
  }

  .row:hover .row-open,
  .row.selected .row-open,
  .row:hover .row-drill,
  .row.selected .row-drill,
  .row-open:focus-visible,
  .row-drill:focus-visible {
    opacity: 1;
  }

  .row:hover,
  .row:focus-visible,
  .row.selected {
    border-color: var(--border);
    background: var(--accent);
    outline: none;
  }

  .row.selected::before {
    content: "";
    position: absolute;
    inset: 0.2rem auto 0.2rem 0;
    width: 2px;
    border-radius: 999px;
    background: var(--primary);
  }

  .skeleton-row {
    height: 2.25rem;
    border-radius: var(--radius-md);
    background: linear-gradient(90deg, color-mix(in oklab, var(--muted) 45%, transparent), color-mix(in oklab, var(--accent) 65%, transparent), color-mix(in oklab, var(--muted) 45%, transparent));
    background-size: 220% 100%;
    animation: picker-sheen 1.2s ease-in-out infinite;
  }

  @keyframes picker-sheen {
    from { background-position: 120% 0; }
    to { background-position: -120% 0; }
  }

  @media (prefers-reduced-motion: reduce) {
    .skeleton-row { animation: none; }
  }

  .empty {
    display: grid;
    place-items: center;
    min-height: 12rem;
    gap: 0.3rem;
    color: var(--muted-foreground);
    text-align: center;
  }

  .empty p {
    margin: 0.3rem 0 0;
    color: var(--foreground);
    font-size: var(--text-sm);
  }

  .empty span {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  /* Footer */
  :global(.project-picker-dialog .dialog-footer) {
    justify-content: space-between;
    gap: 0.75rem;
  }

  .footer-path {
    display: flex;
    min-width: 0;
    flex: 1;
    align-items: center;
    gap: 0.4rem;
    color: var(--muted-foreground);
  }

  .footer-path > :global(svg) {
    flex: none;
    color: var(--primary);
  }

  .footer-path-text {
    overflow: hidden;
    min-width: 0;
    color: var(--foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .footer-signals {
    display: flex;
    flex: none;
    align-items: center;
    gap: 0.25rem;
  }

  .footer-actions {
    display: flex;
    flex: none;
    align-items: center;
    gap: 0.6rem;
  }

  :global(.hidden-switch) {
    height: 1.75rem;
    gap: 0.45rem;
    border: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
    border-radius: var(--radius-sm);
    background: var(--input);
    padding: 0 0.45rem;
    font-size: var(--text-xs);
  }

  :global(.hidden-switch) :global(.switch-copy small) {
    display: none;
  }

  @media (max-width: 560px) {
    :global(.project-picker-dialog) {
      width: calc(100vw - 12px);
      max-height: calc(100vh - 12px);
    }

    .crumb {
      max-width: 7rem;
    }

    .path-tools :global(.hidden-switch) :global(.switch-copy) {
      display: none;
    }
  }
</style>
