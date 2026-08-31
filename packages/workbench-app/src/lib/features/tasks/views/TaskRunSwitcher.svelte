<script lang="ts">
import Check from "@lucide/svelte/icons/check";
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import ChevronUp from "@lucide/svelte/icons/chevron-up";
import RotateCw from "@lucide/svelte/icons/rotate-cw";
import Skull from "@lucide/svelte/icons/skull";
import Square from "@lucide/svelte/icons/square";
import Trash2 from "@lucide/svelte/icons/trash-2";
import type { TaskRecord } from "@nervekit/contracts/tasks";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import { slide } from "svelte/transition";
import { formatTaskRunTime } from "./task-panel-controller.js";
import TaskStatusIcon from "./TaskStatusIcon.svelte";

let {
  currentTaskId,
  runs,
  canRestart = true,
  canCancel = true,
  onSelectRun,
  onRestartRun,
  onCancelRun,
  onForceKillRun,
  onCleanupRuns,
}: {
  currentTaskId: string;
  runs: readonly TaskRecord[];
  canRestart?: boolean;
  canCancel?: boolean;
  onSelectRun?: (taskId: string) => void | Promise<void>;
  onRestartRun?: (taskId: string) => void | Promise<void>;
  onCancelRun?: (taskId: string) => void | Promise<void>;
  onForceKillRun?: (taskId: string) => void | Promise<void>;
  onCleanupRuns?: (taskIds: readonly string[]) => void | Promise<void>;
} = $props();

let expanded = $state(false);
let cleanupOpen = $state(false);
const current = $derived(runs.find((run) => run.id === currentTaskId));
const active = $derived(
  current &&
    ["starting", "running", "ready", "recovered"].includes(current.status),
);
const sortedRuns = $derived(
  [...runs].sort((left, right) =>
    right.startedAt.localeCompare(left.startedAt),
  ),
);
const cleanableRuns = $derived(
  sortedRuns.filter(
    (run) =>
      run.id !== currentTaskId &&
      [
        "completed",
        "failed",
        "timed_out",
        "cancelled",
        "orphaned",
        "interrupted",
      ].includes(run.status),
  ),
);

function selectRun(taskId: string): void {
  expanded = false;
  if (taskId !== currentTaskId) void onSelectRun?.(taskId);
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
        ariaLabel="Show task run history"
        aria-expanded={expanded}
        onclick={() => (expanded = !expanded)}
      >
        <TaskStatusIcon status={current.status} />
        <span class="min-w-0 flex-1 truncate text-left">
          {formatTaskRunTime(current.startedAt)}
        </span>
      </Button>
      <div
        class="flex shrink-0 items-center gap-0.5 pr-1"
        role="group"
        aria-label="Task actions"
      >
        <Button
          variant="ghost"
          size="icon-xs"
          class="size-5 rounded-sm aria-expanded:bg-transparent aria-expanded:text-card-foreground"
          ariaLabel={expanded
            ? "Hide task run history"
            : "Show task run history"}
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
            ariaLabel="Force kill task"
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
            ariaLabel="Restart task"
            disabled={!canRestart}
            onclick={() => void onRestartRun?.(current.id)}
          >
            <RotateCw aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            class="size-5 rounded-sm"
            ariaLabel="Stop task"
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
            ariaLabel="Restart task"
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
        aria-label="Task run history"
      >
        {#each sortedRuns as run (run.id)}
          <button
            type="button"
            class="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            aria-current={run.id === currentTaskId ? "true" : undefined}
            onclick={() => selectRun(run.id)}
          >
            <TaskStatusIcon status={run.status} />
            <span class="min-w-0 flex-1 truncate">
              {formatTaskRunTime(run.startedAt)}
            </span>
            {#if run.id === currentTaskId}
              <Check
                class="size-3.5 shrink-0 text-primary"
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
  title="Clean up old task runs?"
  description={`This removes ${cleanableRuns.length} old finished ${cleanableRuns.length === 1 ? "run" : "runs"} and their captured logs. The current run is retained.`}
  confirmLabel="Clean up"
  onConfirm={() => void onCleanupRuns?.(cleanableRuns.map((run) => run.id))}
/>
