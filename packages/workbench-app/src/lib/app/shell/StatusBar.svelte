<script lang="ts">
import ArrowDown from "@lucide/svelte/icons/arrow-down";
import ArrowUp from "@lucide/svelte/icons/arrow-up";
import Diff from "@lucide/svelte/icons/diff";
import GitBranch from "@lucide/svelte/icons/git-branch";
import Terminal from "@lucide/svelte/icons/terminal";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { ShellStatusBar, type DockToggle } from "$lib/presentation/shell";
import type { TaskRecord, ProjectRecord, StatusResponse } from "$lib/api";
import type { SubscriptionUsageEntry } from "$lib/features/usage";
import { tildePath } from "$lib/domain/filesystem/project-path";
import StatusPopover from "./StatusPopover.svelte";
import { SubscriptionUsageChip } from "$lib/features/usage";
import LayoutControl from "./LayoutControl.svelte";

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
  onOpenPendingApproval?: () => void;
  tasks?: TaskRecord[];
  gitStatus?: GitStatus;
  subscriptionUsages?: SubscriptionUsageEntry[];
  status?: StatusResponse;
  homeDir?: string;
  zoomLevel?: number;
  dockToggles?: DockToggle[];
  phone?: boolean;
  onZoomLevelChange?: (level: number) => void;
};

let {
  activeProject,
  connection = "connecting",
  live = false,
  pendingApprovals = 0,
  onOpenPendingApproval,
  tasks = [],
  gitStatus,
  subscriptionUsages = [],
  status,
  homeDir,
  zoomLevel = 0,
  dockToggles = [],
  phone = false,
  onZoomLevelChange,
}: Props = $props();

const activeTasks = $derived(
  tasks.filter((task) =>
    ["starting", "running", "ready", "stopping"].includes(task.status),
  ).length,
);
const projectPath = $derived(
  activeProject ? tildePath(activeProject.dir, homeDir) : "No project",
);

const hasUsage = $derived(
  subscriptionUsages.some((entry) =>
    Boolean(entry.usage?.session ?? entry.usage?.weekly),
  ),
);
// Phone: usage outranks the project path for the one available slot, but the
// path still fills it when there is no subscription usage to show.
const showUsageInLeft = $derived(phone && hasUsage);

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
  if (status.changeCount > 0)
    details.push(changeCountLabel(status.changeCount));
  if ((status.ahead ?? 0) > 0) details.push(`${status.ahead} ahead`);
  if ((status.behind ?? 0) > 0) details.push(`${status.behind} behind`);
  if (!status.hasUpstream && !status.detached) details.push("No upstream");
  return details.join(" • ");
}
</script>

<ShellStatusBar toggles={dockToggles}>
  {#snippet left()}
    {#if showUsageInLeft}
      <SubscriptionUsageChip usages={subscriptionUsages} compact />
    {:else}
      <span class="footer-project-path" title={activeProject?.dir}
        >{projectPath}</span
      >
    {/if}

    {#if !phone && gitStatus}
      <span class="footer-item footer-git" title={gitStatusTitle(gitStatus)}>
        <GitBranch size={12} strokeWidth={2.1} aria-hidden="true" />
        <span class="footer-git-branch">{gitStatus.branch}</span>
        {#if gitStatus.changeCount > 0}
          <span
            class="footer-git-detail"
            aria-label={changeCountLabel(gitStatus.changeCount)}
          >
            <Diff
              size={11}
              strokeWidth={2.1}
              aria-hidden="true"
            />{gitStatus.changeCount}
          </span>
        {:else if gitStatus.dirty}
          <span class="footer-git-dot" aria-label="Uncommitted changes">•</span>
        {/if}
        {#if (gitStatus.ahead ?? 0) > 0}
          <span
            class="footer-git-detail"
            aria-label={`${gitStatus.ahead} ahead`}
          >
            <ArrowUp
              size={11}
              strokeWidth={2.1}
              aria-hidden="true"
            />{gitStatus.ahead}
          </span>
        {/if}
        {#if (gitStatus.behind ?? 0) > 0}
          <span
            class="footer-git-detail"
            aria-label={`${gitStatus.behind} behind`}
          >
            <ArrowDown
              size={11}
              strokeWidth={2.1}
              aria-hidden="true"
            />{gitStatus.behind}
          </span>
        {/if}
      </span>
    {/if}
  {/snippet}

  {#snippet right()}
    <span class="inline-flex items-center gap-1" data-tour-id="status-controls">
      {#if !phone}
        {#if activeTasks > 0}
          <span class="footer-item" title="Running tasks">
            <Terminal size={12} strokeWidth={2.1} aria-hidden="true" />
            <span>{activeTasks}</span>
          </span>
        {/if}

        {#if pendingApprovals > 0}
          <Button
            variant="ghost"
            size="xs"
            class="footer-item warn text-xs"
            ariaLabel={`Open ${pendingApprovals === 1 ? "pending approval" : "pending approvals"}`}
            title={`${pendingApprovals} ${pendingApprovals === 1 ? "pending approval" : "pending approvals"} · Open conversation`}
            onclick={() => onOpenPendingApproval?.()}
          >
            <TriangleAlert size={12} strokeWidth={2.1} aria-hidden="true" />
            <span>{pendingApprovals}</span>
          </Button>
        {/if}

        <SubscriptionUsageChip usages={subscriptionUsages} />

        <LayoutControl {zoomLevel} {dockToggles} {onZoomLevelChange} />
      {/if}

      <StatusPopover {connection} {live} {status} side="top" compact={phone} />
    </span>
  {/snippet}
</ShellStatusBar>

<style>
/* Shared shape for the status chips in this bar. */
.footer-item {
  display: inline-flex;
  align-items: center;
  flex: none;
  gap: 0.3rem;
  height: 1.375rem;
  border-radius: var(--radius-sm);
  padding: 0 0.375rem;
  color: var(--muted-foreground);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

/* The chip icons are Lucide components (escape-hatch reason 5). */
.footer-item :global(svg) {
  flex: none;
  color: color-mix(in oklab, var(--muted-foreground) 80%, transparent);
}

.footer-item.warn,
.footer-item.warn :global(svg) {
  color: var(--warning);
}

.footer-project-path {
  flex: 0 1 auto;
  overflow: hidden;
  min-width: 0;
  margin-left: 0.25rem;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
}

.footer-git {
  min-width: 0;
  gap: 0.4rem;
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
}

.footer-git-dot {
  color: color-mix(in oklab, var(--muted-foreground) 80%, transparent);
}
</style>
