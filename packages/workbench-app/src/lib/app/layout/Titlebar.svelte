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
import { NerveMark } from "@nervekit/workbench-ui";
import { WorkbenchTitlebar } from "@nervekit/workbench-ui/components/workbench";
import {
  ProjectSwitcher,
  type ProjectSwitcherItem,
} from "$lib/features/projects";
import { Button } from "@nervekit/ui-kit/components/ui/button";

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

<WorkbenchTitlebar {desktop}>
  {#snippet left()}
    <span class="brand">
      <span class="brand-mark"><NerveMark compact /></span>
    </span>
    <span class="divider" aria-hidden="true"></span>
    <ProjectSwitcher
      items={projects}
      activeKey={activeProjectKey}
      onSelect={onSelectProject}
      onOpenPicker={onOpenProject}
    />
  {/snippet}

  {#snippet actions()}
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
        <span class="window-divider" aria-hidden="true"></span>
        <Button
          variant="ghost"
          size="icon-sm"
          class="window-control"
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
          class="window-control"
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
          class="window-control close-control"
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
</WorkbenchTitlebar>
