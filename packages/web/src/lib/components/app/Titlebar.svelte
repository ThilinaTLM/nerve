<script lang="ts">
  import Folder from "@lucide/svelte/icons/folder";
  import Settings from "@lucide/svelte/icons/settings";
  import { Toolbar } from "bits-ui";
  import type { ProjectRecord } from "../../api";
  import { Button } from "$lib/components/ui/button";

  type Props = {
    activeProject?: ProjectRecord;
    settingsActive?: boolean;
    onOpenProject?: () => void;
    onOpenSettings?: () => void;
  };

  let {
    activeProject,
    settingsActive = false,
    onOpenProject,
    onOpenSettings,
  }: Props = $props();

  const projectLabel = $derived(activeProject?.name ?? "Open Project");
</script>

<header class="titlebar">
  <div class="title-left">
    <span class="app-name">Nerve</span>
    <span class="divider" aria-hidden="true"></span>
    <Button
      variant="ghost"
      size="sm"
      class="project-button"
      ariaLabel="Open project"
      title={activeProject?.dir ?? "Open a project"}
      onclick={() => onOpenProject?.()}
    >
      <Folder size={14} strokeWidth={2.1} aria-hidden="true" />
      <span class="project-button-label">{projectLabel}</span>
    </Button>
  </div>

  <Toolbar.Root class="title-actions" aria-label="Application actions">
    <Button
      variant="ghost"
      size="icon-sm"
      ariaLabel="Open settings"
      title="Open settings"
      active={settingsActive}
      pressed={settingsActive}
      onclick={() => onOpenSettings?.()}
    >
      <Settings size={16} strokeWidth={2.1} />
    </Button>
  </Toolbar.Root>
</header>

<style>
  .titlebar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    height: 3rem;
    border-bottom: 1px solid var(--border);
    background: var(--card);
    padding: 0 0.75rem;
    user-select: none;
  }

  .title-left,
  :global(.title-actions) {
    display: flex;
    align-items: center;
    min-width: 0;
    gap: 0.625rem;
  }

  :global(.title-actions) {
    flex: none;
    gap: 0.375rem;
  }

  .app-name {
    color: var(--foreground);
    font-family: var(--font-sans);
    font-size: var(--text-base);
    font-weight: 700;
    letter-spacing: -0.01em;
  }

  .divider {
    width: 1px;
    height: 1.25rem;
    background: var(--border);
  }

  :global(.project-button) {
    min-width: 0;
    gap: 0.4rem;
  }

  :global(.project-button) :global(svg) {
    flex: none;
    color: color-mix(in oklab, var(--muted-foreground) 85%, transparent);
  }

  .project-button-label {
    overflow: hidden;
    max-width: 18rem;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-sm);
    font-weight: 500;
  }
</style>
