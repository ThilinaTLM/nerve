<script lang="ts">
  import Folder from "@lucide/svelte/icons/folder";
  import Settings from "@lucide/svelte/icons/settings";
  import { Toolbar } from "bits-ui";
  import type { ProjectRecord } from "../../api";
  import { Button } from "$lib/components/ui/button";
  import nerveMark from "$lib/assets/nerve-mark.svg?raw";

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

</script>

<header class="titlebar">
  <div class="title-left">
    <span class="brand">
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      <span class="brand-mark" aria-hidden="true">{@html nerveMark}</span>
    </span>
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
      <span class="project-button-label">Open Project</span>
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

  .brand {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    color: var(--foreground);
  }

  .brand-mark {
    display: inline-flex;
    flex: none;
    color: var(--foreground);
  }

  .brand-mark :global(svg) {
    width: 1.2rem;
    height: 1.2rem;
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
