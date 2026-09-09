<script lang="ts">
import ArrowDown from "@lucide/svelte/icons/arrow-down";
import ArrowUp from "@lucide/svelte/icons/arrow-up";
import Diff from "@lucide/svelte/icons/diff";
import GitBranch from "@lucide/svelte/icons/git-branch";
import Terminal from "@lucide/svelte/icons/terminal";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { cn } from "@nervekit/ui-kit/utils";
import {
  ShellStatusBar,
  STATUS_BAR_CHIP,
  STATUS_BAR_CHIP_BUTTON,
  type DockToggle,
} from "$lib/presentation/shell";
import type {
  MaintenanceOperation,
  TaskRecord,
  ProjectRecord,
  StatusResponse,
} from "$lib/api";
import type { SubscriptionUsageEntry } from "$lib/features/usage";
import { tildePath } from "$lib/domain/filesystem/project-path";
import StatusPopover from "./StatusPopover.svelte";
import { SubscriptionUsageChip } from "$lib/features/usage";
import LayoutControl from "./LayoutControl.svelte";
import MaintenanceStatus from "./MaintenanceStatus.svelte";

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
  maintenanceOperation?: MaintenanceOperation | null;
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
  maintenanceOperation,
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
// Phones have no room for a path, and truncating one from the left hides the
// part that identifies the project, so show the project name instead.
const projectLabel = $derived(
  phone ? (activeProject?.name ?? "No project") : projectPath,
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
    <span
      class={cn(STATUS_BAR_CHIP, "min-w-0 shrink")}
      title={activeProject?.dir}
    >
      <span class="truncate">{projectLabel}</span>
    </span>

    {#if !phone && gitStatus}
      <span
        class={cn(STATUS_BAR_CHIP, "min-w-0 shrink gap-2")}
        title={gitStatusTitle(gitStatus)}
      >
        <GitBranch size={12} strokeWidth={2.1} aria-hidden="true" />
        <span class="max-w-40 min-w-0 truncate">{gitStatus.branch}</span>
        {#if gitStatus.changeCount > 0}
          <span
            class="inline-flex items-center gap-0.5"
            aria-label={changeCountLabel(gitStatus.changeCount)}
          >
            <Diff
              size={11}
              strokeWidth={2.1}
              aria-hidden="true"
            />{gitStatus.changeCount}
          </span>
        {:else if gitStatus.dirty}
          <span aria-label="Uncommitted changes">•</span>
        {/if}
        {#if (gitStatus.ahead ?? 0) > 0}
          <span
            class="inline-flex items-center gap-0.5"
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
            class="inline-flex items-center gap-0.5"
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

    <!-- Attention chips sit next to the work they describe, and stay visible on
         phones where the informational chips give up their space first. -->
    {#if activeTasks > 0}
      <span
        class={STATUS_BAR_CHIP}
        title={`${activeTasks} running ${activeTasks === 1 ? "task" : "tasks"}`}
      >
        <Terminal size={12} strokeWidth={2.1} aria-hidden="true" />
        <span>{activeTasks}</span>
      </span>
    {/if}

    {#if pendingApprovals > 0}
      <Button
        variant="ghost"
        size="xs"
        class={cn(
          STATUS_BAR_CHIP_BUTTON,
          "text-warning hover:text-warning focus-visible:text-warning",
        )}
        ariaLabel={`Open ${pendingApprovals === 1 ? "pending approval" : "pending approvals"}`}
        title={`${pendingApprovals} ${pendingApprovals === 1 ? "pending approval" : "pending approvals"} · Open conversation`}
        onclick={() => onOpenPendingApproval?.()}
      >
        <TriangleAlert size={12} strokeWidth={2.1} aria-hidden="true" />
        <span>{pendingApprovals}</span>
      </Button>
    {/if}
  {/snippet}

  {#snippet right()}
    <span
      class="inline-flex items-center gap-0.5"
      data-tour-id="status-controls"
    >
      {#if maintenanceOperation}
        <MaintenanceStatus operation={maintenanceOperation} />
      {/if}

      <SubscriptionUsageChip usages={subscriptionUsages} compact={phone} />

      {#if !phone}
        <LayoutControl {zoomLevel} {dockToggles} {onZoomLevelChange} />
      {/if}

      <StatusPopover {connection} {live} {status} side="top" compact={phone} />
    </span>
  {/snippet}
</ShellStatusBar>
