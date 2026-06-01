<script lang="ts">
  import Folder from "lucide-svelte/icons/folder";
  import FolderOpen from "lucide-svelte/icons/folder-open";
  import MoveUp from "lucide-svelte/icons/move-up";
  import Button from "../ui/Button.svelte";
  import Dialog from "../ui/Dialog.svelte";
  import Input from "../ui/Input.svelte";
  import Switch from "../ui/Switch.svelte";
  import { listDirectories, type FilesystemDirectoryResponse } from "../../api";

  type Props = {
    open?: boolean;
    onClose?: () => void;
    onSelect?: (path: string) => void | Promise<void>;
  };

  let { open = $bindable(false), onClose, onSelect }: Props = $props();

  let pathDraft = $state("");
  let showHidden = $state(false);
  let listing = $state<FilesystemDirectoryResponse | undefined>(undefined);
  let loading = $state(false);
  let error = $state<string | undefined>(undefined);
  let wasOpen = $state(false);
  let previousShowHidden = $state(false);

  async function load(path?: string) {
    loading = true;
    error = undefined;
    try {
      listing = await listDirectories(path, showHidden);
      pathDraft = listing.path;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      loading = false;
    }
  }

  function handleOpenChange(next: boolean) {
    open = next;
    if (!next) onClose?.();
  }

  async function selectCurrent() {
    if (!listing?.path) return;
    await onSelect?.(listing.path);
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
  title="Open project"
  description="Select a local directory before starting an agent conversation."
  class="project-picker-dialog"
  onOpenChange={handleOpenChange}
>
  <div class="picker-body">
    <form class="path-row" onsubmit={(event) => { event.preventDefault(); void load(pathDraft); }}>
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
      <Input bind:value={pathDraft} placeholder="/path/to/project" disabled={loading} ariaLabel="Project directory path" />
      <Button size="sm" disabled={loading}>Go</Button>
    </form>

    <div class="picker-options">
      <Switch bind:checked={showHidden} label="Show hidden directories" description="Include dot-prefixed folders in this directory list." />
    </div>

    {#if error}<p class="picker-error">{error}</p>{/if}

    <div class="directory-list" aria-busy={loading}>
      {#if loading}
        <p class="muted">Loading directories…</p>
      {:else if listing?.entries.length}
        <div class="directory-table" role="list" aria-label="Child directories">
          {#each listing.entries as entry}
            <button class="directory-row" type="button" onclick={() => void load(entry.path)} title={entry.path}>
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
    </div>
  </div>

  {#snippet footer()}
    <span class="current-path" title={listing?.path}>{listing?.path ?? "—"}</span>
    <Button size="sm" disabled={!listing?.path || loading} onclick={selectCurrent}>Open here</Button>
  {/snippet}
</Dialog>

<style>
  :global(.project-picker-dialog) {
    width: min(780px, calc(100vw - 32px));
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
    border-bottom: 1px solid var(--color-border-subtle);
    padding: 0.55rem 0.65rem;
  }

  .path-row :global(.ui-input) {
    min-width: 0;
  }

  .picker-options {
    justify-content: space-between;
    background: var(--color-panel-muted);
  }

  .picker-error {
    margin: 0;
    padding: 0.45rem 0.65rem;
    border-bottom: 1px solid var(--color-border-subtle);
    color: var(--color-danger);
    font-size: 0.8rem;
  }

  .directory-list {
    min-height: 19rem;
    overflow: auto;
    padding: 0.35rem;
  }

  .directory-table {
    display: grid;
    gap: 0.12rem;
  }

  .directory-row {
    display: grid;
    grid-template-columns: auto minmax(8rem, 0.7fr) minmax(0, 1.3fr);
    align-items: center;
    width: 100%;
    gap: 0.5rem;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text);
    padding: 0.4rem 0.5rem;
    text-align: left;
    cursor: pointer;
  }

  .directory-row:hover,
  .directory-row:focus-visible {
    border-color: var(--color-border-subtle);
    background: var(--color-panel-raised);
  }

  .directory-row :global(svg) {
    color: var(--color-accent);
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
    color: var(--color-muted);
    font-size: 0.75rem;
  }

  .empty-directory {
    display: grid;
    place-items: center;
    min-height: 14rem;
    color: var(--color-muted);
    text-align: center;
  }

  .empty-directory p {
    margin: 0.5rem 0 0.1rem;
    color: var(--color-text);
  }

  .current-path {
    margin-right: auto;
    max-width: min(34rem, 60vw);
  }

  @media (max-width: 680px) {
    .directory-row {
      grid-template-columns: auto minmax(0, 1fr);
    }

    .directory-row small {
      grid-column: 2;
    }
  }
</style>
