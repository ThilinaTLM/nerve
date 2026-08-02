<script lang="ts">
import Copy from "@lucide/svelte/icons/copy";
import CloudCog from "@lucide/svelte/icons/cloud-cog";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import Logs from "@lucide/svelte/icons/logs";
import Minus from "@lucide/svelte/icons/minus";
import Settings from "@lucide/svelte/icons/settings";
import Square from "@lucide/svelte/icons/square";
import X from "@lucide/svelte/icons/x";
import { Toolbar } from "bits-ui";
import { NerveMark } from "$lib/presentation";
import { ShellTitlebar } from "$lib/presentation/shell";
import {
  ProjectSwitcher,
  type ProjectSwitcherItem,
} from "$lib/features/projects";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/ui/context-menu-list";
import type { LatestRelease } from "@nervekit/contracts";
import VersionIndicator from "$lib/app/shell/VersionIndicator.svelte";

type Props = {
  projects?: ProjectSwitcherItem[];
  activeProjectKey?: string;
  desktop?: boolean;
  maximized?: boolean;
  closeToTray?: boolean;
  quitting?: boolean;
  settingsActive?: boolean;
  authActive?: boolean;
  logsActive?: boolean;
  applicationLogsEnabled?: boolean;
  currentVersion?: string;
  latestRelease?: LatestRelease;
  buildProjectMenuItems?: (item: ProjectSwitcherItem) => ContextMenuItem[];
  onOpenProject?: () => void;
  onSelectProject?: (projectId: string) => void;
  onOpenLogs?: () => void;
  onOpenAuth?: () => void;
  onOpenSettings?: () => void;
  onMinimize?: () => void;
  onToggleMaximize?: () => void;
  onClose?: () => void;
};

let {
  projects = [],
  activeProjectKey,
  desktop = false,
  maximized = false,
  closeToTray = true,
  quitting = false,
  settingsActive = false,
  authActive = false,
  logsActive = false,
  applicationLogsEnabled = false,
  currentVersion,
  latestRelease,
  buildProjectMenuItems,
  onOpenProject,
  onSelectProject,
  onOpenLogs,
  onOpenAuth,
  onOpenSettings,
  onMinimize,
  onToggleMaximize,
  onClose,
}: Props = $props();
</script>

<ShellTitlebar {desktop}>
  {#snippet left()}
    <span class="inline-flex items-center gap-1.5 text-foreground">
      <span class="brand-mark"><NerveMark compact /></span>
    </span>
    <span class="h-5 w-px bg-border" aria-hidden="true"></span>
    <ProjectSwitcher
      items={projects}
      activeKey={activeProjectKey}
      buildMenuItems={buildProjectMenuItems}
      onSelect={onSelectProject}
      onOpenPicker={onOpenProject}
    />
  {/snippet}

  {#snippet actions()}
    <Toolbar.Root
      class="flex min-w-0 flex-none items-center gap-1.5 [-webkit-app-region:no-drag]"
      aria-label="Application actions"
    >
      {#if currentVersion}
        <VersionIndicator {currentVersion} {latestRelease} />
      {/if}
      {#if applicationLogsEnabled}
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
      {/if}
      <Button
        variant="ghost"
        size="icon-sm"
        ariaLabel="Open authentication"
        title="Providers & authentication"
        active={authActive}
        pressed={authActive}
        onclick={() => onOpenAuth?.()}
      >
        <CloudCog size={16} strokeWidth={2.1} />
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
        <span class="mx-0.5 h-5 w-px bg-border" aria-hidden="true"></span>
        <Button
          variant="ghost"
          size="icon-sm"
          class="[-webkit-app-region:no-drag]"
          ariaLabel="Minimize window"
          title="Minimize"
          disabled={quitting}
          onclick={() => onMinimize?.()}
        >
          <Minus size={16} strokeWidth={2.1} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          class="[-webkit-app-region:no-drag]"
          ariaLabel={maximized ? "Restore window" : "Maximize window"}
          title={maximized ? "Restore" : "Maximize"}
          disabled={quitting}
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
          class="[-webkit-app-region:no-drag] hover:bg-destructive-solid hover:text-destructive-solid-foreground focus-visible:bg-destructive-solid focus-visible:text-destructive-solid-foreground"
          ariaLabel={quitting
            ? "Closing Nerve"
            : closeToTray
              ? "Close window to tray"
              : "Close Nerve"}
          title={quitting
            ? "Closing Nerve…"
            : closeToTray
              ? "Close to tray"
              : "Close Nerve"}
          disabled={quitting}
          onclick={() => onClose?.()}
        >
          {#if quitting}
            <Spinner />
          {:else}
            <X size={16} strokeWidth={2.1} />
          {/if}
        </Button>
      {/if}
    </Toolbar.Root>
  {/snippet}
</ShellTitlebar>

<style>
/* NerveMark renders its own svg (escape-hatch reason 5). */
.brand-mark {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 1rem;
  height: 1rem;
  border-radius: var(--radius-sm);
  color: var(--background);
  background: var(--foreground);
}

.brand-mark :global(svg) {
  width: 0.625rem;
  height: 0.625rem;
  /* Compensate for the mark's top-left visual weight at titlebar size. */
  transform: translate(5%, 5%);
}
</style>
