<script lang="ts">
import CircleCheck from "@lucide/svelte/icons/circle-check";
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import ChevronUp from "@lucide/svelte/icons/chevron-up";
import RotateCw from "@lucide/svelte/icons/rotate-cw";
import Skull from "@lucide/svelte/icons/skull";
import Square from "@lucide/svelte/icons/square";
import Trash2 from "@lucide/svelte/icons/trash-2";
import type { LaunchRecord } from "@nervekit/contracts/launches";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import { slide } from "svelte/transition";
import { formatLaunchRunTime } from "./launch-panel-controller.js";
import LaunchStatusIcon from "./LaunchStatusIcon.svelte";

let {
  currentLaunchId,
  runs,
  canRestart = true,
  canCancel = true,
  onSelectRun,
  onRestartRun,
  onCancelRun,
  onForceKillRun,
  onCleanupRuns,
}: {
  currentLaunchId: string;
  runs: readonly LaunchRecord[];
  canRestart?: boolean;
  canCancel?: boolean;
  onSelectRun?: (launchId: string) => void | Promise<void>;
  onRestartRun?: (launchId: string) => void | Promise<void>;
  onCancelRun?: (launchId: string) => void | Promise<void>;
  onForceKillRun?: (launchId: string) => void | Promise<void>;
  onCleanupRuns?: (launchIds: readonly string[]) => void | Promise<void>;
} = $props();

let expanded = $state(false);
let cleanupOpen = $state(false);
const current = $derived(runs.find((run) => run.id === currentLaunchId));
const active = $derived(
  current && ["starting", "running", "ready"].includes(current.status),
);
const sortedRuns = $derived(
  [...runs].sort((left, right) =>
    right.startedAt.localeCompare(left.startedAt),
  ),
);
const cleanableRuns = $derived(
  sortedRuns.filter(
    (run) =>
      run.id !== currentLaunchId &&
      ["completed", "failed", "timed_out", "cancelled"].includes(run.status),
  ),
);

function selectRun(launchId: string): void {
  expanded = false;
  if (launchId !== currentLaunchId) void onSelectRun?.(launchId);
}
</script>

{#if runs.length > 1 && current}
  <div
    class="absolute top-3 right-4 z-10 w-56 overflow-hidden rounded-md border border-border bg-card text-card-foreground shadow-md"
  >
    <div class="flex items-center transition-colors hover:bg-muted">
      <Button
        variant="ghost"
        size="sm"
        class="min-w-0 flex-1 justify-start rounded-none px-2 text-xs aria-expanded:bg-transparent aria-expanded:text-card-foreground"
        ariaLabel="Show launch run history"
        aria-expanded={expanded}
        onclick={() => (expanded = !expanded)}
      >
        <LaunchStatusIcon status={current.status} />
        <span class="min-w-0 flex-1 truncate text-left">
          {formatLaunchRunTime(current.startedAt)}
        </span>
      </Button>
      <div
        class="flex shrink-0 items-center gap-0.5 pr-1"
        role="group"
        aria-label="Launch actions"
      >
        <Button
          variant="ghost"
          size="icon-xs"
          class="size-5 rounded-sm aria-expanded:bg-transparent aria-expanded:text-card-foreground"
          ariaLabel={expanded
            ? "Hide launch run history"
            : "Show launch run history"}
          aria-expanded={expanded}
          onclick={() => (expanded = !expanded)}
        >
          {#if expanded}
            <ChevronUp aria-hidden="true" />
          {:else}
            <ChevronDown aria-hidden="true" />
          {/if}
        </Button>
        {#if current.status === "stopping"}
          <Button
            variant="ghost"
            size="icon-xs"
            class="size-5 rounded-sm"
            ariaLabel="Force kill launch"
            disabled={!canCancel}
            onclick={() => void onForceKillRun?.(current.id)}
          >
            <Skull aria-hidden="true" />
          </Button>
        {:else if active}
          <Button
            variant="ghost"
            size="icon-xs"
            class="size-5 rounded-sm"
            ariaLabel="Restart launch"
            disabled={!canRestart}
            onclick={() => void onRestartRun?.(current.id)}
          >
            <RotateCw aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            class="size-5 rounded-sm"
            ariaLabel="Stop launch"
            disabled={!canCancel}
            onclick={() => void onCancelRun?.(current.id)}
          >
            <Square aria-hidden="true" />
          </Button>
        {:else}
          <Button
            variant="ghost"
            size="icon-xs"
            class="size-5 rounded-sm"
            ariaLabel="Restart launch"
            disabled={!canRestart}
            onclick={() => void onRestartRun?.(current.id)}
          >
            <RotateCw aria-hidden="true" />
          </Button>
        {/if}
        <Button
          variant="ghost"
          size="icon-xs"
          class="size-5 rounded-sm"
          ariaLabel="Clean up old runs"
          disabled={cleanableRuns.length === 0 || !onCleanupRuns}
          onclick={() => (cleanupOpen = true)}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
    </div>

    {#if expanded}
      <div
        class="max-h-64 overflow-y-auto border-t border-border py-1"
        transition:slide={{ duration: 140 }}
        role="list"
        aria-label="Launch run history"
      >
        {#each sortedRuns as run (run.id)}
          <button
            type="button"
            class="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            aria-current={run.id === currentLaunchId ? "true" : undefined}
            onclick={() => selectRun(run.id)}
          >
            <LaunchStatusIcon status={run.status} />
            <span class="min-w-0 flex-1 truncate">
              {formatLaunchRunTime(run.startedAt)}
            </span>
            {#if run.id === currentLaunchId}
              <CircleCheck
                class="size-3.5 shrink-0 text-foreground"
                aria-hidden="true"
              />
            {/if}
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<ConfirmDialog
  bind:open={cleanupOpen}
  destructive
  title="Clean up old launch runs?"
  description={`This removes ${cleanableRuns.length} old finished ${cleanableRuns.length === 1 ? "run" : "runs"} and their captured logs. The current run is retained.`}
  confirmLabel="Clean up"
  onConfirm={() => void onCleanupRuns?.(cleanableRuns.map((run) => run.id))}
/>
