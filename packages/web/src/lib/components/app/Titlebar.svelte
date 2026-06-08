<script lang="ts">
  import Copy from "@lucide/svelte/icons/copy";
  import Folder from "@lucide/svelte/icons/folder";
  import Logs from "@lucide/svelte/icons/logs";
  import Minus from "@lucide/svelte/icons/minus";
  import Settings from "@lucide/svelte/icons/settings";
  import Square from "@lucide/svelte/icons/square";
  import X from "@lucide/svelte/icons/x";
  import { Toolbar } from "bits-ui";
  import type { ProjectRecord } from "../../api";
  import { Button } from "$lib/components/ui/button";
  import nerveMark from "$lib/assets/nerve-mark.svg?raw";

  type Props = {
    activeProject?: ProjectRecord;
    desktop?: boolean;
    maximized?: boolean;
    closeToTray?: boolean;
    settingsActive?: boolean;
    logsActive?: boolean;
    onOpenProject?: () => void;
    onOpenLogs?: () => void;
    onOpenSettings?: () => void;
    onMinimize?: () => void;
    onToggleMaximize?: () => void;
    onClose?: () => void;
  };

  let {
    activeProject,
    desktop = false,
    maximized = false,
    closeToTray = true,
    settingsActive = false,
    logsActive = false,
    onOpenProject,
    onOpenLogs,
    onOpenSettings,
    onMinimize,
    onToggleMaximize,
    onClose,
  }: Props = $props();
</script>

<header class="titlebar" class:desktop>
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
      ariaLabel="Open Nerve logs"
      title="Open Nerve logs"
      active={logsActive}
      pressed={logsActive}
      onclick={() => onOpenLogs?.()}
    >
      <Logs size={16} strokeWidth={2.1} />
    </Button>
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
    {#if desktop}
      <span class="window-divider" aria-hidden="true"></span>
      <Button
        variant="ghost"
        size="icon-sm"
        class="window-control"
        ariaLabel="Minimize window"
        title="Minimize"
        onclick={() => onMinimize?.()}
      >
        <Minus size={16} strokeWidth={2.1} />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        class="window-control"
        ariaLabel={maximized ? "Restore window" : "Maximize window"}
        title={maximized ? "Restore" : "Maximize"}
        onclick={() => onToggleMaximize?.()}
      >
        {#if maximized}
          <Copy size={15} strokeWidth={2.1} />
        {:else}
          <Square size={14} strokeWidth={2.1} />
        {/if}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        class="window-control close-control"
        ariaLabel={closeToTray ? "Close window to tray" : "Close Nerve"}
        title={closeToTray ? "Close to tray" : "Close Nerve"}
        onclick={() => onClose?.()}
      >
        <X size={16} strokeWidth={2.1} />
      </Button>
    {/if}
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

  .titlebar.desktop {
    -webkit-app-region: drag;
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
    -webkit-app-region: no-drag;
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

  .divider,
  .window-divider {
    width: 1px;
    height: 1.25rem;
    background: var(--border);
  }

  .window-divider {
    margin: 0 0.125rem;
  }

  :global(.project-button) {
    min-width: 0;
    gap: 0.4rem;
    -webkit-app-region: no-drag;
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

  :global(.window-control) {
    -webkit-app-region: no-drag;
  }

  :global(.close-control:hover),
  :global(.close-control:focus-visible) {
    background: var(--destructive);
    color: var(--destructive-foreground, var(--primary-foreground));
  }
</style>
