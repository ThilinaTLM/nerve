<script lang="ts">
import ArrowDown from "@lucide/svelte/icons/arrow-down";
import ArrowUp from "@lucide/svelte/icons/arrow-up";
import Diff from "@lucide/svelte/icons/diff";
import GitBranch from "@lucide/svelte/icons/git-branch";
import Terminal from "@lucide/svelte/icons/terminal";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import { ShellStatusBar, type DockToggle } from "$lib/presentation/shell";
import type { TaskRecord, ProjectRecord, StatusResponse } from "$lib/api";
import type { SubscriptionUsageEntry } from "$lib/features/usage";
import { tildePath } from "$lib/core/utils/path";
import StatusPopover from "./StatusPopover.svelte";
import SubscriptionUsageChip from "$lib/features/usage/components/SubscriptionUsageChip.svelte";
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
    {#if !phone}
      {#if activeTasks > 0}
        <span class="footer-item" title="Running tasks">
          <Terminal size={12} strokeWidth={2.1} aria-hidden="true" />
          <span>{activeTasks}</span>
        </span>
      {/if}

      {#if pendingApprovals > 0}
        <span class="footer-item warn" title="Pending approvals">
          <TriangleAlert size={12} strokeWidth={2.1} aria-hidden="true" />
          <span>{pendingApprovals}</span>
        </span>
      {/if}

      <SubscriptionUsageChip usages={subscriptionUsages} />

      <LayoutControl {zoomLevel} {dockToggles} {onZoomLevelChange} />
    {/if}

    <StatusPopover {connection} {live} {status} side="top" compact={phone} />
  {/snippet}
</ShellStatusBar>
