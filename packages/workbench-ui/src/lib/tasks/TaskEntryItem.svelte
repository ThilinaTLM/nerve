<script lang="ts">
import History from "@lucide/svelte/icons/history";
import Pencil from "@lucide/svelte/icons/pencil";
import Play from "@lucide/svelte/icons/play";
import RotateCw from "@lucide/svelte/icons/rotate-cw";
import Square from "@lucide/svelte/icons/square";
import Trash2 from "@lucide/svelte/icons/trash-2";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { StatusDot } from "@nervekit/ui-kit/components/ui/status-dot";
import { taskPulse, taskTone } from "@nervekit/ui-kit/core/utils/status";
import type { TaskPanelEntry } from "./task-panel-types";

let {
  entry,
  selected = false,
  onOpen,
  onRun,
  onCancel,
  onRestart,
  onEdit,
  onDelete,
}: {
  entry: TaskPanelEntry;
  selected?: boolean;
  onOpen?: (taskId: string) => void;
  onRun?: () => void;
  onCancel?: (taskId: string) => void;
  onRestart?: (taskId: string) => void;
  onEdit?: () => void;
  onDelete?: () => void;
} = $props();

const latest = $derived(entry.latestRun);
const status = $derived(latest?.status ?? "saved");
const label = $derived(
  entry.definition?.label ??
    latest?.displayName ??
    latest?.name ??
    entry.definition?.command ??
    latest?.command ??
    "Task",
);
const command = $derived(entry.definition?.command ?? latest?.command ?? "");
const concurrent = $derived(entry.definition?.runPolicy === "concurrent");
const canStart = $derived(
  Boolean(entry.definition) && (concurrent || entry.activeRuns.length === 0),
);
const active = $derived(entry.activeRuns[0]);
</script>

<div
  class="group/row flex items-center gap-1 rounded-md border bg-card pr-1.5 transition-colors hover:border-ring/40 data-[active=true]:border-primary/60 data-[active=true]:bg-muted/40"
  data-active={selected}
>
  <button
    class="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2.5 py-2 text-left"
    type="button"
    onclick={() => latest && onOpen?.(latest.id)}
    disabled={!latest}
  >
    {#if entry.needsRecovery}<TriangleAlert
        class="size-3.5 shrink-0 text-warning"
      />{:else}<StatusDot
        tone={latest ? taskTone(latest.status) : "neutral"}
        pulse={latest ? taskPulse(latest.status) : false}
      />{/if}
    <div class="min-w-0 flex-1">
      <div class="truncate text-xs font-medium text-foreground">{label}</div>
      {#if command !== label}<div
          class="truncate font-mono text-xs text-muted-foreground"
        >
          {command}
        </div>{/if}
    </div>
    {#if entry.activeRuns.length > 1}<Badge tone="accent" size="xs"
        >{entry.activeRuns.length} running</Badge
      >{/if}
    {#if entry.runs.length > 1}<Badge tone="neutral" size="xs"
        ><History class="mr-1 size-3" />{entry.runs.length}</Badge
      >{/if}
    <Badge tone={latest ? taskTone(latest.status) : "neutral"} size="xs"
      >{status}</Badge
    >
  </button>
  <div class="flex shrink-0 items-center gap-0.5">
    {#if canStart}<Button
        size="icon-xs"
        variant="ghost"
        ariaLabel={concurrent && active ? "Start another run" : "Run task"}
        title={concurrent && active ? "Start another run" : "Run task"}
        onclick={() => onRun?.()}><Play class="size-3" /></Button
      >{/if}
    {#if entry.definition}<Button
        size="icon-xs"
        variant="ghost"
        ariaLabel="Edit task"
        title="Edit task"
        onclick={() => onEdit?.()}><Pencil class="size-3" /></Button
      ><Button
        size="icon-xs"
        variant="ghost"
        ariaLabel="Delete saved task"
        title="Delete saved task"
        class="text-muted-foreground hover:text-destructive"
        onclick={() => onDelete?.()}><Trash2 class="size-3" /></Button
      >{/if}
    {#if active}<Button
        size="icon-xs"
        variant="ghost"
        ariaLabel="Restart task"
        title="Restart task"
        onclick={() => onRestart?.(active.id)}
        ><RotateCw class="size-3" /></Button
      ><Button
        size="icon-xs"
        variant="ghost"
        ariaLabel="Stop task"
        title="Stop task"
        class="text-muted-foreground hover:text-destructive"
        onclick={() => onCancel?.(active.id)}><Square class="size-3" /></Button
      >{/if}
  </div>
</div>
