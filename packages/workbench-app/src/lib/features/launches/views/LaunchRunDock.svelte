<script lang="ts">
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import RotateCw from "@lucide/svelte/icons/rotate-cw";
import Skull from "@lucide/svelte/icons/skull";
import Square from "@lucide/svelte/icons/square";
import Trash2 from "@lucide/svelte/icons/trash-2";
import type { LaunchRecord } from "@nervekit/contracts/launches";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import { FloatingToolbar } from "@nervekit/ui-kit/components/composites/floating-toolbar";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import PopoverPanel, {
  PopoverBody,
  PopoverHeader,
  PopoverRow,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import { formatLaunchRunTime } from "./launch-panel-controller.js";
import LaunchStatusIcon from "./LaunchStatusIcon.svelte";

let {
  launch,
  runs,
  canRestart = true,
  canCancel = true,
  onSelectRun,
  onRestartRun,
  onCancelRun,
  onForceKillRun,
  onCleanupRuns,
}: {
  launch: Pick<LaunchRecord, "id" | "status" | "startedAt">;
  runs: readonly LaunchRecord[];
  canRestart?: boolean;
  canCancel?: boolean;
  onSelectRun?: (launchId: string) => void | Promise<void>;
  onRestartRun?: (launchId: string) => void | Promise<void>;
  onCancelRun?: (launchId: string) => void | Promise<void>;
  onForceKillRun?: (launchId: string) => void | Promise<void>;
  onCleanupRuns?: (launchIds: readonly string[]) => void | Promise<void>;
} = $props();

let historyOpen = $state(false);
let cleanupOpen = $state(false);
const active = $derived(
  ["starting", "running", "ready"].includes(launch.status),
);
const sortedRuns = $derived(
  [...runs].sort((left, right) =>
    right.startedAt.localeCompare(left.startedAt),
  ),
);
const cleanableRuns = $derived(
  sortedRuns.filter(
    (run) =>
      run.id !== launch.id &&
      ["completed", "failed", "timed_out", "cancelled"].includes(run.status),
  ),
);

function selectRun(launchId: string): void {
  historyOpen = false;
  if (launchId !== launch.id) void onSelectRun?.(launchId);
}
</script>

<FloatingToolbar label="Launch controls">
  {#if runs.length > 1}
    <PopoverPanel
      bind:open={historyOpen}
      size="sm"
      ariaLabel="Show launch run history"
      triggerTitle="Run history"
      side="top"
      align="start"
    >
      {#snippet triggerChild({ props })}
        <Button {...props} variant="ghost" size="sm">
          <LaunchStatusIcon status={launch.status} />
          <span class="tabular-nums"
            >{formatLaunchRunTime(launch.startedAt)}</span
          >
          <ChevronDown
            class="size-3 text-muted-foreground"
            aria-hidden="true"
          />
        </Button>
      {/snippet}
      <PopoverHeader title="Runs" meta={String(runs.length)}>
        {#snippet actions()}
          {#if onCleanupRuns}
            <IconAction
              icon={Trash2}
              label="Clean up old runs"
              disabled={cleanableRuns.length === 0}
              onclick={() => {
                historyOpen = false;
                cleanupOpen = true;
              }}
            />
          {/if}
        {/snippet}
      </PopoverHeader>
      <PopoverBody ariaLabel="Launch run history">
        {#each sortedRuns as run (run.id)}
          <PopoverRow
            selected={run.id === launch.id}
            label={formatLaunchRunTime(run.startedAt)}
            onclick={() => selectRun(run.id)}
          >
            {#snippet icon()}
              <LaunchStatusIcon status={run.status} />
            {/snippet}
          </PopoverRow>
        {/each}
      </PopoverBody>
    </PopoverPanel>
  {:else}
    <span class="flex h-6 items-center gap-1.5 px-1.5 text-ui">
      <LaunchStatusIcon status={launch.status} />
      <span class="tabular-nums">{formatLaunchRunTime(launch.startedAt)}</span>
    </span>
  {/if}

  {#if launch.status === "stopping"}
    <Button
      variant="ghost"
      size="icon-sm"
      ariaLabel="Force kill launch"
      title="Force kill"
      disabled={!canCancel}
      onclick={() => void onForceKillRun?.(launch.id)}
    >
      <Skull aria-hidden="true" />
    </Button>
  {:else}
    <Button
      variant="ghost"
      size="icon-sm"
      ariaLabel="Restart launch"
      title="Restart"
      disabled={!canRestart}
      onclick={() => void onRestartRun?.(launch.id)}
    >
      <RotateCw aria-hidden="true" />
    </Button>
    {#if active}
      <Button
        variant="ghost"
        size="icon-sm"
        ariaLabel="Stop launch"
        title="Stop"
        disabled={!canCancel}
        onclick={() => void onCancelRun?.(launch.id)}
      >
        <Square aria-hidden="true" />
      </Button>
    {/if}
  {/if}
</FloatingToolbar>

<ConfirmDialog
  bind:open={cleanupOpen}
  destructive
  title="Clean up old launch runs?"
  description={`This removes ${cleanableRuns.length} old finished ${cleanableRuns.length === 1 ? "run" : "runs"} and their captured logs. The current run is retained.`}
  confirmLabel="Clean up"
  onConfirm={() => void onCleanupRuns?.(cleanableRuns.map((run) => run.id))}
/>
