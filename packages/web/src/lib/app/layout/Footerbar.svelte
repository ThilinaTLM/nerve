<script lang="ts">
  import ArrowDown from "@lucide/svelte/icons/arrow-down";
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import Diff from "@lucide/svelte/icons/diff";
  import GitBranch from "@lucide/svelte/icons/git-branch";
  import Terminal from "@lucide/svelte/icons/terminal";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import { WorkbenchFooterbar } from "@nervekit/ui/components/workbench";
  import type {
    TaskRecord,
    ProjectRecord,
    StatusResponse,
  } from "$lib/api";
  import type { SubscriptionUsageEntry } from "$lib/features/usage";
  import { shortenPath } from "$lib/core/utils/path";
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
    if (status.changeCount > 0) details.push(changeCountLabel(status.changeCount));
    if ((status.ahead ?? 0) > 0) details.push(`${status.ahead} ahead`);
    if ((status.behind ?? 0) > 0) details.push(`${status.behind} behind`);
    if (!status.hasUpstream && !status.detached) details.push("No upstream");
    return details.join(" • ");
  }
</script>

<WorkbenchFooterbar
  {sidebarCollapsed}
  {utilityCollapsed}
  onToggleSidebar={onToggleSidebar}
  onToggleUtility={onToggleUtility}
>
  {#snippet left()}
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
  {/snippet}

  {#snippet right()}
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
  {/snippet}
</WorkbenchFooterbar>
