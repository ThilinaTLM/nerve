<script lang="ts">
import CloudCog from "@lucide/svelte/icons/cloud-cog";
import Logs from "@lucide/svelte/icons/logs";
import CircleHelp from "@lucide/svelte/icons/circle-help";
import Settings from "@lucide/svelte/icons/settings";
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
import WindowControls from "$lib/app/shell/WindowControls.svelte";
import type { ResolvedHeaderType } from "$lib/app/shell/header-type";

type Props = {
  projects?: ProjectSwitcherItem[];
  activeProjectKey?: string;
  desktop?: boolean;
  headerType?: ResolvedHeaderType;
  maximized?: boolean;
  closeToTray?: boolean;
  quitting?: boolean;
  settingsActive?: boolean;
  guideActive?: boolean;
  guideUnseen?: boolean;
  setupPaused?: boolean;
  setupReady?: number;
  setupTotal?: number;
  authActive?: boolean;
  logsActive?: boolean;
  applicationLogsEnabled?: boolean;
  currentVersion?: string;
  latestRelease?: LatestRelease;
  buildProjectMenuItems?: (item: ProjectSwitcherItem) => ContextMenuItem[];
  onOpenProject?: () => void;
  onSelectProject?: (projectId: string) => void;
  onOpenLogs?: () => void;
  onOpenGuide?: () => void;
  onContinueSetup?: () => void;
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
  headerType = "linux",
  maximized = false,
  closeToTray = true,
  quitting = false,
  settingsActive = false,
  guideActive = false,
  guideUnseen = false,
  setupPaused = false,
  setupReady = 0,
  setupTotal = 5,
  authActive = false,
  logsActive = false,
  applicationLogsEnabled = false,
  currentVersion,
  latestRelease,
  buildProjectMenuItems,
  onOpenProject,
  onSelectProject,
  onOpenLogs,
  onOpenGuide,
  onContinueSetup,
  onOpenAuth,
  onOpenSettings,
  onMinimize,
  onToggleMaximize,
  onClose,
}: Props = $props();
</script>

<ShellTitlebar {desktop}>
  {#snippet leadingControls()}
    {#if desktop && headerType === "macos"}
      <WindowControls
        {headerType}
        {maximized}
        {closeToTray}
        {quitting}
        {onMinimize}
        {onToggleMaximize}
        {onClose}
      />
    {/if}
  {/snippet}
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
      {#if setupPaused && setupReady < setupTotal}
        <Button
          size="sm"
          class="max-sm:hidden"
          data-tour-id="help"
          ariaLabel={`Continue setup. ${setupReady} of ${setupTotal} complete`}
          title="Continue setup"
          active={guideActive}
          pressed={guideActive}
          onclick={() => onContinueSetup?.()}
        >
          <span
            class="animate-pulse"
            role="progressbar"
            aria-label={`Setup progress: ${setupReady} of ${setupTotal} complete`}
            aria-valuemin="0"
            aria-valuemax={setupTotal}
            aria-valuenow={setupReady}
          >
            <svg
              class="size-4 -rotate-90"
              viewBox="0 0 20 20"
              aria-hidden="true"
            >
              <circle
                class="text-primary-foreground/30"
                cx="10"
                cy="10"
                r="8"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                pathLength="100"
              />
              <circle
                class="text-primary-foreground"
                cx="10"
                cy="10"
                r="8"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                pathLength="100"
                stroke-dasharray="100"
                stroke-dashoffset={100 - (setupReady / setupTotal) * 100}
              />
            </svg>
          </span>
          <span>Continue setup ({setupReady}/{setupTotal})</span>
        </Button>
      {:else}
        <Button
          variant="ghost"
          size="icon-sm"
          class="relative max-sm:hidden"
          data-tour-id="help"
          ariaLabel="Open setup and product tour"
          title="Open setup and product tour"
          active={guideActive}
          pressed={guideActive}
          onclick={() => onOpenGuide?.()}
        >
          <CircleHelp size={16} strokeWidth={2.1} />
          {#if guideUnseen}
            <span
              class="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-info"
              aria-label="New setup or tour guidance available"
            ></span>
          {/if}
        </Button>
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
        data-tour-id="providers"
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
        data-tour-id="settings"
        active={settingsActive}
        pressed={settingsActive}
        onclick={() => onOpenSettings?.()}
      >
        <Settings size={16} strokeWidth={2.1} />
      </Button>
      {#if desktop && headerType !== "macos"}
        <span class="mx-0.5 h-5 w-px bg-border" aria-hidden="true"></span>
        <WindowControls
          {headerType}
          {maximized}
          {closeToTray}
          {quitting}
          {onMinimize}
          {onToggleMaximize}
          {onClose}
        />
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
