<script lang="ts">
  import Button from "../ui/Button.svelte";
  import Input from "../ui/Input.svelte";
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

  function close() {
    open = false;
    onClose?.();
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

{#if open}
  <div class="picker-backdrop" role="presentation" onclick={close}></div>
  <div class="picker" role="dialog" aria-modal="true" aria-label="Open project directory">
    <header class="picker-header">
      <div>
        <strong>Open project</strong>
        <span>Select a directory before starting an agent conversation.</span>
      </div>
      <Button variant="ghost" size="sm" onclick={close}>Close</Button>
    </header>

    <form class="path-row" onsubmit={(event) => { event.preventDefault(); void load(pathDraft); }}>
      <Button type="button" variant="secondary" size="sm" disabled={!listing?.parent || loading} onclick={() => void load(listing?.parent)}>Up</Button>
      <Input bind:value={pathDraft} placeholder="/path/to/project" disabled={loading} />
      <Button size="sm" disabled={loading}>Go</Button>
    </form>

    <label class="hidden-toggle">
      <input type="checkbox" bind:checked={showHidden} />
      show hidden directories
    </label>

    {#if error}<p class="picker-error">{error}</p>{/if}

    <div class="directory-list" aria-busy={loading}>
      {#if loading}
        <p class="muted">Loading directories…</p>
      {:else if listing?.entries.length}
        {#each listing.entries as entry}
          <button class="directory-row" type="button" onclick={() => void load(entry.path)}>
            <span>{entry.name}</span>
            <small>{entry.path}</small>
          </button>
        {/each}
      {:else}
        <p class="muted">No child directories.</p>
      {/if}
    </div>

    <footer class="picker-footer">
      <span>{listing?.path ?? "—"}</span>
      <Button size="sm" disabled={!listing?.path || loading} onclick={selectCurrent}>Open here</Button>
    </footer>
  </div>
{/if}

<style>
  .picker-backdrop {
    position: fixed;
    inset: 0;
    z-index: 30;
    background: rgb(0 0 0 / 44%);
  }

  .picker {
    position: fixed;
    z-index: 31;
    top: 9vh;
    left: 50%;
    display: grid;
    grid-template-rows: auto auto auto auto minmax(0, 1fr) auto;
    width: min(760px, calc(100vw - 32px));
    max-height: 78vh;
    transform: translateX(-50%);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-panel);
    color: var(--color-text);
  }

  .picker-header,
  .picker-footer,
  .path-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.55rem 0.65rem;
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .picker-header {
    justify-content: space-between;
  }

  .picker-header div {
    display: grid;
    gap: 0.1rem;
  }

  .picker-header span,
  .picker-footer span,
  .muted,
  .directory-row small {
    color: var(--color-muted);
    font-size: 0.75rem;
  }

  .path-row :global(.ui-input) {
    min-width: 0;
  }

  .hidden-toggle {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.45rem 0.65rem;
    color: var(--color-muted);
    font-size: 0.78rem;
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .picker-error {
    margin: 0;
    padding: 0.45rem 0.65rem;
    border-bottom: 1px solid var(--color-border-subtle);
    color: var(--color-danger);
    font-size: 0.8rem;
  }

  .directory-list {
    min-height: 18rem;
    overflow: auto;
    padding: 0.35rem;
  }

  .directory-row {
    display: grid;
    width: 100%;
    gap: 0.15rem;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text);
    padding: 0.4rem 0.5rem;
    text-align: left;
    cursor: pointer;
  }

  .directory-row:hover {
    background: var(--color-panel-raised);
  }

  .picker-footer {
    justify-content: space-between;
    border-top: 1px solid var(--color-border-subtle);
    border-bottom: 0;
  }
</style>
