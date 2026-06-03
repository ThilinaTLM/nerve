<script lang="ts">
  import CheckCircle2 from "@lucide/svelte/icons/check-circle-2";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Folder from "@lucide/svelte/icons/folder";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import GitBranch from "@lucide/svelte/icons/git-branch";
  import MoveUp from "@lucide/svelte/icons/move-up";
  import PackageIcon from "@lucide/svelte/icons/package";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Search from "@lucide/svelte/icons/search";
  import Terminal from "@lucide/svelte/icons/terminal";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import Dialog from "$lib/components/ui/dialog-shell";
  import { Input } from "$lib/components/ui/input";
  import Switch from "$lib/components/ui/switch-field";
  import {
    listDirectories,
    type FilesystemDirectoryResponse,
    type FilesystemSignal,
    type ProjectRecord,
    type SessionRecord,
  } from "../../api";
  import { tildePath } from "../../utils/path";
  import { dateTimeLabel } from "../../utils/time";

  type Props = {
    open?: boolean;
    projects?: ProjectRecord[];
    sessions?: SessionRecord[];
    homeDir?: string;
    onClose?: () => void;
    onSelect?: (path: string) => void | Promise<void>;
  };

  type SignalMeta = {
    label: string;
    title: string;
    tone?: "neutral" | "accent" | "good" | "warn" | "danger" | "running";
    icon: typeof GitBranch;
  };

  type FilesystemEntry = FilesystemDirectoryResponse["entries"][number];
  type Crumb = { label: string; path: string };

  let {
    open = $bindable(false),
    projects = [],
    sessions = [],
    homeDir,
    onClose,
    onSelect,
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

  function pathKey(path: string): string {
    const trimmed = path.trim().replace(/[\\/]+$/, "") || path.trim();
    return trimmed.toLowerCase();
  }

  function leafName(path: string | undefined): string {
    if (!path) return "";
    const normalized = path.replace(/[\\/]+$/, "");
    const parts = normalized.split(/[\\/]/).filter(Boolean);
    return parts.at(-1) ?? (normalized || path);
  }

  function uniqueSignals(signals: FilesystemSignal[] | undefined): FilesystemSignal[] {
    return [...new Set(signals ?? [])];
  }

  function looksLikePath(value: string): boolean {
    const v = value.trim();
    return v.startsWith("/") || v.startsWith("~") || v.includes("/");
  }

  function expandHome(value: string): string {
    const v = value.trim();
    if (homeDir && (v === "~" || v.startsWith("~/"))) return `${homeDir}${v.slice(1)}`;
    return v;
  }

  function breadcrumbFor(path: string | undefined, home?: string): Crumb[] {
    if (!path) return [];
    const norm = path.replace(/\/+$/, "");
    const normHome = home?.replace(/\/+$/, "");
    const crumbs: Crumb[] = [];
    let base = "";
    let rest = norm;

    if (normHome && (norm === normHome || norm.startsWith(`${normHome}/`))) {
      crumbs.push({ label: "~", path: normHome });
      base = normHome;
      rest = norm.slice(normHome.length);
    } else {
      crumbs.push({ label: "/", path: "/" });
      base = "";
      rest = norm;
    }

    let acc = base;
    for (const part of rest.split("/").filter(Boolean)) {
      acc = `${acc}/${part}`;
      crumbs.push({ label: part, path: acc });
    }
    return crumbs;
  }

  const openedProjectKeys = $derived.by(() => new Set(projects.map((project) => pathKey(project.dir))));

  const sessionCounts = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const session of sessions) {
      counts.set(session.projectId, (counts.get(session.projectId) ?? 0) + 1);
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

  const selectedEntry = $derived<FilesystemEntry | undefined>(
    selectedIndex >= 0 ? filteredEntries[selectedIndex] : undefined,
  );
  const openTargetPath = $derived(selectedEntry?.path ?? listing?.path ?? "");
  const openTargetSignals = $derived(uniqueSignals(selectedEntry?.signals ?? listing?.signals));
  const crumbs = $derived(breadcrumbFor(listing?.path, homeDir));

  function isOpened(path: string): boolean {
    return openedProjectKeys.has(pathKey(path));
  }

  function sessionCountFor(project: ProjectRecord): number {
    return sessionCounts.get(project.id) ?? 0;
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
    const first = filteredEntries[0];
    if (first) void load(first.path);
  }

  async function openTarget() {
    const path = openTargetPath;
    if (!path) return;
    await onSelect?.(path);
  }

  function handleKeydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    const inInput = target?.tagName === "INPUT";
    const count = filteredEntries.length;

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
        if (!inInput && selectedEntry) {
          event.preventDefault();
          void load(selectedEntry.path);
        }
        break;
      case "Enter":
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault();
          void openTarget();
        } else if (!inInput && selectedEntry) {
          event.preventDefault();
          void load(selectedEntry.path);
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
  {#snippet headerActions()}
    <nav class="crumbs" aria-label="Current location">
      {#each crumbs as crumb, i}
        {#if i > 0}<span class="crumb-sep" aria-hidden="true">/</span>{/if}
        {#if i === crumbs.length - 1}
          <span class="crumb current" title={crumb.path}>{crumb.label}</span>
        {:else}
          <button class="crumb" type="button" title={crumb.path} disabled={loading} onclick={() => void load(crumb.path)}>
            {crumb.label}
          </button>
        {/if}
      {/each}
    </nav>
    <div class="crumb-tools">
      <Button variant="ghost" size="icon-sm" disabled={!listing?.parent || loading} title="Parent directory" onclick={() => void load(listing?.parent)}>
        <MoveUp size={14} strokeWidth={2.2} />
      </Button>
      <Button variant="ghost" size="icon-sm" disabled={loading} title="Refresh" onclick={reloadCurrent}>
        <RefreshCw size={14} strokeWidth={2.2} />
      </Button>
    </div>
  {/snippet}

  <div class="picker-body" role="presentation" onkeydown={handleKeydown}>
    <form class="picker-search" onsubmit={handleSubmit}>
      <Search size={14} strokeWidth={2.2} aria-hidden="true" />
      <Input
        bind:value={query}
        oninput={() => (selectedIndex = -1)}
        placeholder="Filter folders or paste a path…"
        disabled={loading}
        size="sm"
        ariaLabel="Filter folders or enter a path"
      />
    </form>

    {#if error}
      <p class="picker-error">{error}</p>
    {/if}

    <div class="picker-scroll" bind:this={listEl}>
      {#if recentProjects.length && !query.trim()}
        <section class="group">
          <header class="group-head"><span>Recent</span></header>
          <div class="rows" role="list" aria-label="Recent projects">
            {#each recentProjects as project}
              <button class="row" type="button" title={project.dir} onclick={() => void onSelect?.(project.dir)}>
                <FolderOpen size={16} strokeWidth={2.05} aria-hidden="true" />
                <span class="row-main"><strong>{project.name}</strong></span>
                <span class="row-meta">
                  <small>{sessionCountFor(project)} conv · {dateTimeLabel(project.updatedAt)}</small>
                  <Badge tone="good" size="xs"><CheckCircle2 size={11} />Opened</Badge>
                </span>
              </button>
            {/each}
          </div>
        </section>
      {/if}

      <section class="group">
        <header class="group-head">
          <span>Folders</span>
          {#if loading}<Badge size="xs">Loading…</Badge>{/if}
        </header>

        {#if loading}
          <div class="rows" aria-label="Loading directories">
            {#each Array.from({ length: 7 }) as _}
              <span class="skeleton-row"></span>
            {/each}
          </div>
        {:else if filteredEntries.length}
          <div class="rows" role="listbox" aria-label="Folders">
            {#each filteredEntries as entry, i}
              <button
                class="row"
                class:selected={selectedIndex === i}
                type="button"
                role="option"
                aria-selected={selectedIndex === i}
                data-index={i}
                title={entry.path}
                onclick={() => (selectedIndex = i)}
                ondblclick={() => void load(entry.path)}
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
                  <ChevronRight class="row-chevron" size={15} strokeWidth={2.2} aria-hidden="true" />
                </span>
              </button>
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
      <span class="footer-path-text">{openTargetPath ? tildePath(openTargetPath, homeDir) : "—"}</span>
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
      <Switch bind:checked={showHidden} label="Hidden" class="hidden-switch" />
      <Button size="sm" disabled={!openTargetPath || loading} onclick={() => void openTarget()}>
        <FolderOpen size={14} strokeWidth={2.2} />
        {openTargetPath ? `Open ${leafName(openTargetPath)}` : "Open"}
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

  :global(.project-picker-dialog .dialog-header-actions) {
    flex: 1;
    flex-wrap: nowrap;
    justify-content: flex-end;
    gap: 0.5rem;
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
    font-size: 0.75rem;
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

  .crumb-sep {
    color: color-mix(in oklab, var(--muted-foreground) 55%, transparent);
  }

  .crumb-tools {
    display: flex;
    flex: none;
    gap: 0.3rem;
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
    font-size: 0.75rem;
  }

  .picker-error {
    margin: 0;
    border-bottom: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
    padding: 0.5rem 0.75rem;
    color: var(--destructive);
    font-size: 0.75rem;
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
    font-size: 0.6875rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
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
    color: var(--primary);
  }

  .row-main {
    min-width: 0;
  }

  .row-main strong {
    display: block;
    overflow: hidden;
    font-size: 0.8125rem;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-meta,
  .row-badges {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.4rem;
  }

  .row-meta small {
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    white-space: nowrap;
  }

  .row :global(.row-chevron) {
    color: var(--muted-foreground);
    opacity: 0;
    transition: opacity 120ms ease;
  }

  .row:hover,
  .row:focus-visible,
  .row.selected {
    border-color: var(--border);
    background: var(--accent);
    outline: none;
  }

  .row:hover :global(.row-chevron),
  .row.selected :global(.row-chevron) {
    opacity: 1;
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
    font-size: 0.8125rem;
  }

  .empty span {
    font-family: var(--font-mono);
    font-size: 0.6875rem;
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
    font-size: 0.75rem;
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
    gap: 0.5rem;
  }

  :global(.hidden-switch) {
    height: 1.75rem;
    gap: 0.45rem;
    border: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
    border-radius: var(--radius-sm);
    background: var(--input);
    padding: 0 0.45rem;
    font-size: 0.75rem;
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

    .footer-actions :global(.hidden-switch) :global(.switch-copy) {
      display: none;
    }
  }
</style>
