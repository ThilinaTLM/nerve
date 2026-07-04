<script lang="ts">
  import ArrowDown from "@lucide/svelte/icons/arrow-down";
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import Diff from "@lucide/svelte/icons/diff";
  import GitBranch from "@lucide/svelte/icons/git-branch";
  import PanelLeft from "@lucide/svelte/icons/panel-left";
  import PanelLeftClose from "@lucide/svelte/icons/panel-left-close";
  import PanelRight from "@lucide/svelte/icons/panel-right";
  import PanelRightClose from "@lucide/svelte/icons/panel-right-close";
  import Terminal from "@lucide/svelte/icons/terminal";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import type {
    TaskRecord,
    ProjectRecord,
    StatusResponse,
  } from "$lib/api";
  import type { SubscriptionUsageEntry } from "$lib/features/usage";
  import { shortenPath } from "$lib/core/utils/path";
  import { Button } from "@nervekit/ui/components/ui/button";
  import StatusPopover from "./StatusPopover.svelte";
  import SubscriptionUsageChip from "$lib/features/usage/components/SubscriptionUsageChip.svelte";
  import ZoomControl from "./ZoomControl.svelte";

  type GitStatus = {
    branch: string;
    dirty: boolean;
    changeCount: number;
    ahead: number | null;
    behind: number | null;
    detached: boolean;
    hasUpstream: boolean;
    relativePath: string;
    repoName: string;
    repoCount: number;
  };

  type Props = {
    activeProject?: ProjectRecord;
    connection?: string;
    live?: boolean;
    pendingApprovals?: number;
    tasks?: TaskRecord[];
    gitStatus?: GitStatus;
    subscriptionUsages?: SubscriptionUsageEntry[];
    status?: StatusResponse;
    homeDir?: string;
    zoomLevel?: number;
    sidebarCollapsed?: boolean;
    utilityCollapsed?: boolean;
    phone?: boolean;
    onZoomLevelChange?: (level: number) => void;
    onToggleSidebar?: () => void;
    onToggleUtility?: () => void;
  };

  let {
    activeProject,
    connection = "connecting",
    live = false,
    pendingApprovals = 0,
    tasks = [],
    gitStatus,
    subscriptionUsages = [],
    status,
    homeDir,
    zoomLevel = 0,
    sidebarCollapsed = false,
    utilityCollapsed = false,
    phone = false,
    onZoomLevelChange,
    onToggleSidebar,
    onToggleUtility,
  }: Props = $props();

  const activeTasks = $derived(
    tasks.filter((task) =>
      ["starting", "running", "ready", "stopping"].includes(task.status),
    ).length,
  );
  const projectPath = $derived(
    activeProject ? shortenPath(activeProject.dir, homeDir) : "No project",
  );

  function changeCountLabel(count: number): string {
    return `${count} ${count === 1 ? "change" : "changes"}`;
  }

  function gitStatusTitle(status: GitStatus): string {
    const details = [
      status.detached ? "Detached HEAD" : `Branch: ${status.branch}`,
    ];
    if (status.repoCount > 1) {
      details.unshift(
        `Repo: ${status.relativePath === "." ? status.repoName : status.relativePath}`,
      );
    }
    if (status.changeCount > 0) {
      details.push(changeCountLabel(status.changeCount));
    }
    if ((status.ahead ?? 0) > 0) details.push(`${status.ahead} ahead`);
    if ((status.behind ?? 0) > 0) details.push(`${status.behind} behind`);
    if (!status.hasUpstream && !status.detached) details.push("No upstream");
    return details.join(" • ");
  }
</script>

<footer class="footerbar">
  <div class="footer-group footer-left">
    <Button
      variant="ghost"
      size="icon-sm"
      class="footer-toggle"
      ariaLabel="Toggle agents panel"
      title={sidebarCollapsed ? "Show agents panel" : "Hide agents panel"}
      pressed={!sidebarCollapsed}
      onclick={() => onToggleSidebar?.()}
    >
      {#if sidebarCollapsed}
        <PanelLeft size={13} strokeWidth={2.1} aria-hidden="true" />
      {:else}
        <PanelLeftClose size={13} strokeWidth={2.1} aria-hidden="true" />
      {/if}
    </Button>
    <span class="footer-project-path" title={activeProject?.dir}>{projectPath}</span>

    {#if !phone && gitStatus}
      <span class="footer-chip footer-git" title={gitStatusTitle(gitStatus)}>
        <GitBranch size={12} strokeWidth={2.1} aria-hidden="true" />
        <span class="footer-git-branch">{gitStatus.branch}{gitStatus.dirty ? "*" : ""}</span>
        {#if gitStatus.changeCount > 0}
          <span class="footer-git-detail" aria-label={changeCountLabel(gitStatus.changeCount)}>
            <Diff size={11} strokeWidth={2.1} aria-hidden="true" />{gitStatus.changeCount}
          </span>
        {/if}
        {#if (gitStatus.ahead ?? 0) > 0}
          <span class="footer-git-detail" aria-label={`${gitStatus.ahead} ahead`}>
            <ArrowUp size={11} strokeWidth={2.1} aria-hidden="true" />{gitStatus.ahead}
          </span>
        {/if}
        {#if (gitStatus.behind ?? 0) > 0}
          <span class="footer-git-detail" aria-label={`${gitStatus.behind} behind`}>
            <ArrowDown size={11} strokeWidth={2.1} aria-hidden="true" />{gitStatus.behind}
          </span>
        {/if}
      </span>
    {/if}
  </div>

  <div class="footer-group footer-right">
    {#if !phone}
      {#if activeTasks > 0}
        <span class="footer-chip" title="Running tasks">
          <Terminal size={12} strokeWidth={2.1} aria-hidden="true" />
          <span>{activeTasks}</span>
        </span>
      {/if}

      {#if pendingApprovals > 0}
        <span class="footer-chip warn" title="Pending approvals">
          <TriangleAlert size={12} strokeWidth={2.1} aria-hidden="true" />
          <span>{pendingApprovals}</span>
        </span>
      {/if}

      <SubscriptionUsageChip usages={subscriptionUsages} />

      <ZoomControl {zoomLevel} {onZoomLevelChange} />
    {/if}

    <StatusPopover {connection} {live} {status} side="top" />

    <Button
      variant="ghost"
      size="icon-sm"
      class="footer-toggle"
      ariaLabel="Toggle utility panel"
      title={utilityCollapsed ? "Show utility panel" : "Hide utility panel"}
      pressed={!utilityCollapsed}
      onclick={() => onToggleUtility?.()}
    >
      {#if utilityCollapsed}
        <PanelRight size={13} strokeWidth={2.1} aria-hidden="true" />
      {:else}
        <PanelRightClose size={13} strokeWidth={2.1} aria-hidden="true" />
      {/if}
    </Button>
  </div>
</footer>

<style>
  .footerbar {
    display: flex;
    align-items: stretch;
    justify-content: space-between;
    gap: 0;
    height: 1.75rem;
    min-width: 0;
    border-top: 1px solid var(--border);
    background: var(--sidebar);
    color: var(--muted-foreground);
    padding: 0;
    font-size: var(--text-xs);
    user-select: none;
  }

  .footer-group {
    display: flex;
    align-items: center;
    height: 100%;
    min-width: 0;
    gap: 0.4rem;
    padding-left: 0.15rem;
  }

  .footer-left {
    flex: 1 1 auto;
    overflow: hidden;
  }

  .footer-right {
    flex: none;
    gap: 0;
    padding-left: 0;
  }

  .footer-right > :global(*) {
    display: inline-flex;
    align-items: center;
    height: 100%;
    border-left: 1px solid var(--border);
  }

  .footer-right > :global(*:first-child) {
    border-left: 0;
  }

  .footer-project-path {
    flex: 0 1 auto;
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .footer-chip {
    display: inline-flex;
    align-items: center;
    flex: none;
    gap: 0.3rem;
    height: 100%;
    padding: 0 0.6rem;
  }

  .footer-chip :global(svg) {
    color: color-mix(in oklab, var(--muted-foreground) 80%, transparent);
  }

  .footer-git {
    min-width: 0;
    border-left: 1px solid var(--border);
  }

  .footer-git-branch {
    overflow: hidden;
    min-width: 0;
    max-width: min(16rem, 30vw);
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
  }

  .footer-git-detail {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    color: var(--muted-foreground);
  }

  .footer-git-detail :global(svg) {
    color: color-mix(in oklab, var(--muted-foreground) 80%, transparent);
  }

  .footer-chip.warn {
    color: var(--warning);
  }

  .footer-chip.warn :global(svg) {
    color: var(--warning);
  }

  :global(.footer-toggle) {
    width: 1.5rem;
    height: 1.5rem;
  }

  /* Phone: fill the taller footer row and grow toggle tap targets. */
  @media (max-width: 639px) {
    .footerbar {
      height: 100%;
      padding-bottom: env(safe-area-inset-bottom);
    }

    :global(.footer-toggle) {
      width: 2.25rem;
      height: 2.25rem;
    }
  }
</style>
