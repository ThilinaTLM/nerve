<script lang="ts">
import Search from "@lucide/svelte/icons/search";
import type { TaskRecord } from "@nervekit/contracts";
import Dialog from "@nervekit/ui-kit/components/ui/dialog-shell";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { ScrollArea } from "@nervekit/ui-kit/components/ui/scroll-area";
import { PanelList, PanelRowCard } from "$lib/presentation/panel";
import TaskRunRow from "./TaskRunRow.svelte";
import { taskRunLabel } from "./task-panel-controller.js";
import type {
  TaskEntryCapabilities,
  TaskRunEntry,
} from "./task-panel-types.js";

let {
  open = $bindable(false),
  runs,
  capabilities,
  onOpen,
  onCancel,
  onForceKill,
  onRestart,
  onRerunDefinition,
  onRemove,
  onCopy,
  onSaveAsDefinition,
  onOpenChange,
}: {
  open?: boolean;
  runs: readonly TaskRunEntry[];
  capabilities: TaskEntryCapabilities;
  onOpen: (taskId: string) => void;
  onCancel: (taskId: string) => void;
  onForceKill: (taskId: string) => void;
  onRestart: (taskId: string) => void;
  onRerunDefinition: (entry: TaskRunEntry) => void;
  onRemove: (taskId: string) => void;
  onCopy: (text: string) => void;
  onSaveAsDefinition: (task: TaskRecord) => void;
  onOpenChange?: (open: boolean) => void;
} = $props();

let filter = $state("");

const matches = $derived.by(() => {
  const needle = filter.trim().toLowerCase();
  if (needle.length === 0) return runs;
  return runs.filter((entry) =>
    `${taskRunLabel(entry).text} ${entry.run.command}`
      .toLowerCase()
      .includes(needle),
  );
});

$effect(() => {
  if (open) filter = "";
});

function handleOpenChange(next: boolean): void {
  open = next;
  onOpenChange?.(next);
}

function openRun(taskId: string): void {
  onOpen(taskId);
  handleOpenChange(false);
}
</script>

<Dialog
  bind:open
  size="wide"
  title="Runs"
  description={`${runs.length} task runs`}
  class="h-[min(40rem,calc(100vh-6rem))]"
  onOpenChange={handleOpenChange}
>
  <div class="flex min-h-0 flex-col">
    <div class="relative flex shrink-0 items-center border-b border-border p-2">
      <Search
        class="pointer-events-none absolute left-4 size-3.5 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        bind:value={filter}
        size="sm"
        class="pl-7"
        placeholder="Filter runs"
        ariaLabel="Filter runs"
      />
    </div>

    <div class="min-h-0 flex-1 p-1">
      {#if matches.length === 0}
        <p class="p-2 text-xs text-muted-foreground">No runs match.</p>
      {:else}
        <ScrollArea class="h-full">
          <PanelList ariaLabel="All runs" class="gap-1">
            {#each matches as entry (entry.key)}
              <PanelRowCard>
                <TaskRunRow
                  {entry}
                  {capabilities}
                  onOpen={openRun}
                  {onCancel}
                  {onForceKill}
                  {onRestart}
                  onRerunDefinition={() => onRerunDefinition(entry)}
                  {onRemove}
                  {onCopy}
                  {onSaveAsDefinition}
                />
              </PanelRowCard>
            {/each}
          </PanelList>
        </ScrollArea>
      {/if}
    </div>
  </div>
</Dialog>
