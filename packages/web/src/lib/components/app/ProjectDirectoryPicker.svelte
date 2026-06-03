<script lang="ts">
  import Folder from "lucide-svelte/icons/folder";
  import FolderOpen from "lucide-svelte/icons/folder-open";
  import MoveUp from "lucide-svelte/icons/move-up";
  import Search from "lucide-svelte/icons/search";
  import Button from "../ui/Button.svelte";
  import Dialog from "../ui/Dialog.svelte";
  import Input from "../ui/Input.svelte";
  import Switch from "../ui/Switch.svelte";
  import { listDirectories, type FilesystemDirectoryResponse, type ProjectRecord } from "../../api";

  type Props = {
    open?: boolean;
    projects?: ProjectRecord[];
    onClose?: () => void;
    onSelect?: (path: string) => void | Promise<void>;
  };

  let { open = $bindable(false), projects = [], onClose, onSelect }: Props = $props();

  let pathDraft = $state("");
  let selectedPath = $state("");
  let showHidden = $state(false);
  let listing = $state<FilesystemDirectoryResponse | undefined>(undefined);
  let loading = $state(false);
  let error = $state<string | undefined>(undefined);
  let wasOpen = $state(false);
  let previousShowHidden = $state(false);

  const recentProjects = $derived.by(() => {
    const seen = new Set<string>();
    return [...projects]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .filter((project) => {
        const key = project.dir.replace(/[\\/]+$/, "") || project.dir;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 6);
  });

  async function load(path?: string) {
    loading = true;
    error = undefined;
    try {
      listing = await listDirectories(path, showHidden);
      pathDraft = listing.path;
      selectedPath = listing.path;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
      if (path) selectedPath = path;
    } finally {
      loading = false;
    }
  }

  function handleOpenChange(next: boolean) {
    open = next;
    if (!next) onClose?.();
  }

  async function selectCurrent() {
    const path = selectedPath || listing?.path;
    if (!path) return;
    await onSelect?.(path);
  }

  $effect(() => {
    if (open && !wasOpen) void load(pathDraft || undefined);
    wasOpen = open;
  });

  $effect(() => {
    if (open && showHidden !== previousShowHidden) void load(pathDraft || undefined);
    previousShowHidden = showHidden;
  });
</script>

<Dialog
  bind:open
  title="Open Local Project"
  description="Choose a directory Nerve can use as the scoped agent workspace."
  class="project-picker-dialog"
  onOpenChange={handleOpenChange}
>
  <div class="picker-body">
    <form class="path-row" onsubmit={(event) => { event.preventDefault(); void load(pathDraft); }}>
      <div class="search-input">
        <Search size={14} strokeWidth={2.2} aria-hidden="true" />
        <Input bind:value={pathDraft} placeholder="/path/to/project" disabled={loading} ariaLabel="Project directory path" />
      </div>
      <Button size="sm" disabled={loading}>Go</Button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={!listing?.parent || loading}
        title="Go to parent directory"
        onclick={() => void load(listing?.parent)}
      >
        <MoveUp size={13} strokeWidth={2.2} />Up
      </Button>
    </form>

    <div class="picker-options">
      <span>Recent Directories</span>
      <Switch bind:checked={showHidden} label="Show hidden" description="Include dot-prefixed folders." />
    </div>

    {#if error}<p class="picker-error">{error}</p>{/if}

    <div class="picker-content" aria-busy={loading}>
      <section class="recent-section">
        {#if recentProjects.length === 0}
          <p class="muted">No recent projects yet.</p>
        {:else}
          <div class="directory-table" role="list" aria-label="Recent directories">
            {#each recentProjects as project}
              <button class="directory-row recent" class:selected={selectedPath === project.dir} type="button" onclick={() => void load(project.dir)} title={project.dir}>
                <FolderOpen size={15} strokeWidth={2.1} aria-hidden="true" />
                <span>{project.name}</span>
                <small>{project.dir}</small>
              </button>
            {/each}
          </div>
        {/if}
      </section>

      <section class="browse-section">
        <header>
          <span>Browse Current Directory</span>
          <small title={listing?.path}>{loading ? "Loading…" : listing?.path ?? "—"}</small>
        </header>
        {#if loading}
          <p class="muted">Loading directories…</p>
        {:else if listing?.entries.length}
          <div class="directory-table" role="list" aria-label="Child directories">
            {#each listing.entries as entry}
              <button class="directory-row" class:selected={selectedPath === entry.path} type="button" onclick={() => void load(entry.path)} title={entry.path}>
                <Folder size={15} strokeWidth={2.1} aria-hidden="true" />
                <span>{entry.name}</span>
                <small>{entry.path}</small>
              </button>
            {/each}
          </div>
        {:else}
          <div class="empty-directory">
            <FolderOpen size={28} strokeWidth={1.8} />
            <p>No child directories.</p>
            <span>You can still open the current path.</span>
          </div>
        {/if}
      </section>
    </div>
  </div>

  {#snippet footer()}
    <span class="current-path" title={selectedPath || listing?.path}>Selected: {(selectedPath || listing?.path) ?? "—"}</span>
    <Button variant="secondary" size="sm" onclick={() => handleOpenChange(false)}>Cancel</Button>
    <Button size="sm" disabled={!(selectedPath || listing?.path) || loading} onclick={selectCurrent}>Open Directory</Button>
  {/snippet}
</Dialog>

<style>
  :global(.project-picker-dialog) {
    width: min(840px, calc(100vw - 32px));
  }

  .picker-body {
    display: grid;
    min-height: 0;
    grid-template-rows: auto auto auto minmax(0, 1fr);
  }

  .path-row,
  .picker-options {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    border-bottom: 1px solid hsl(var(--border) / 0.6);
    padding: 0.65rem 0.75rem;
  }

  .search-input {
    position: relative;
    display: grid;
    min-width: 0;
    flex: 1;
  }

  .search-input :global(svg) {
    position: absolute;
    z-index: 1;
    top: 50%;
    left: 0.65rem;
    color: hsl(var(--muted-foreground));
    transform: translateY(-50%);
    pointer-events: none;
  }

  .search-input :global(.ui-input) {
    padding-left: 2rem;
  }

  .picker-options {
    justify-content: space-between;
    background: hsl(var(--muted));
  }

  .picker-options > span,
  .browse-section header span {
    color: hsl(var(--muted-foreground));
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
  }

  .picker-error {
    margin: 0;
    padding: 0.45rem 0.75rem;
    border-bottom: 1px solid hsl(var(--border) / 0.6);
    color: hsl(var(--destructive));
    font-size: var(--text-xs);
  }

  .picker-content {
    display: grid;
    grid-template-columns: minmax(13rem, 0.8fr) minmax(0, 1.2fr);
    min-height: 23rem;
    overflow: hidden;
  }

  .recent-section,
  .browse-section {
    min-height: 0;
    overflow: auto;
    padding: 0.45rem;
  }

  .recent-section {
    border-right: 1px solid hsl(var(--border) / 0.6);
    background: hsl(var(--muted));
  }

  .browse-section header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.4rem;
    padding: 0.1rem 0.2rem;
  }

  .browse-section header small {
    overflow: hidden;
    color: hsl(var(--muted-foreground));
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .directory-table {
    display: grid;
    gap: 0.14rem;
  }

  .directory-row {
    position: relative;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-rows: auto auto;
    align-items: center;
    width: 100%;
    column-gap: 0.6rem;
    row-gap: 0.05rem;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: hsl(var(--foreground));
    padding: 0.45rem 0.5rem 0.45rem 0.65rem;
    text-align: left;
    cursor: pointer;
  }

  .directory-row span {
    grid-column: 2;
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
  }

  .directory-row small {
    grid-column: 2;
  }

  .directory-row.selected span {
    color: hsl(var(--primary));
  }

  .directory-row:hover,
  .directory-row:focus-visible,
  .directory-row.selected {
    border-color: hsl(var(--border));
    background: hsl(var(--accent));
  }

  .directory-row.selected::before {
    content: "";
    position: absolute;
    inset: 0.15rem auto 0.15rem 0;
    width: 2px;
    border-radius: 999px;
    background: hsl(var(--primary));
  }

  .directory-row :global(svg) {
    grid-row: 1 / 3;
    color: hsl(var(--primary));
  }

  .directory-row span,
  .directory-row small,
  .current-path {
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .directory-row small,
  .current-path,
  .muted,
  .empty-directory span {
    color: hsl(var(--muted-foreground));
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
  }

  .empty-directory {
    display: grid;
    place-items: center;
    min-height: 14rem;
    color: hsl(var(--muted-foreground));
    text-align: center;
  }

  .empty-directory p {
    margin: 0.5rem 0 0.1rem;
    color: hsl(var(--foreground));
  }

  .muted {
    margin: 0.45rem;
  }

  .current-path {
    margin-right: auto;
    max-width: min(34rem, 52vw);
  }

  @media (max-width: 760px) {
    .picker-content {
      grid-template-columns: minmax(0, 1fr);
    }

    .recent-section {
      border-right: 0;
      border-bottom: 1px solid hsl(var(--border) / 0.6);
    }

  }
</style>
