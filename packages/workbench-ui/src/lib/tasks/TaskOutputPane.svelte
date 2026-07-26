<script lang="ts">
import Terminal from "@lucide/svelte/icons/terminal";
import type {
  TaskLogEvent,
  TaskLogQueryResponse,
  TaskRecord,
} from "@nervekit/contracts";
import SelectField from "@nervekit/ui-kit/components/ui/select-field";
import {
  emptyTaskLogFilter,
  isTaskLogFilterActive,
  type TaskLogFilterState,
} from "./task-log-filter.js";
import TaskLogTerminal from "./TaskLogTerminal.svelte";
import TaskLogToolbar from "./TaskLogToolbar.svelte";

type Props = {
  task?: Pick<TaskRecord, "id" | "command" | "status" | "error" | "runtime">;
  taskLogs?: TaskLogQueryResponse;
  runs?: readonly TaskRecord[];
  historyNotice?: string;
  searchingHistory?: boolean;
  onSelectRun?: (taskId: string) => void;
  onLoadEarlier?: () => void | Promise<void>;
  onSearchHistory?: (filter: { text: string; useRegex: boolean }) => void;
  onBackToLive?: () => void;
  onCopyOutput?: (text: string) => void;
};

let {
  task,
  taskLogs,
  runs = [],
  historyNotice,
  searchingHistory = false,
  onSelectRun,
  onLoadEarlier,
  onSearchHistory,
  onBackToLive,
  onCopyOutput,
}: Props = $props();

let filter = $state<TaskLogFilterState>({ ...emptyTaskLogFilter });
let follow = $state(true);
let wrap = $state(true);
let visibleEvents = $state<readonly TaskLogEvent[]>([]);
let filterError = $state<string | undefined>(undefined);
let lastTaskId = $state<string | undefined>(undefined);

// Filters are per run; reset them when the viewed run changes.
$effect(() => {
  if (task?.id === lastTaskId) return;
  lastTaskId = task?.id;
  filter = { ...emptyTaskLogFilter };
  follow = true;
});

const runItems = $derived(
  [...runs]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .map((run) => ({
      value: run.id,
      label: `${run.status} · ${new Date(run.startedAt).toLocaleString()}`,
      detail: run.id,
    })),
);
const canSearchHistory = $derived(
  Boolean(
    onSearchHistory &&
    !historyNotice &&
    filter.text.trim().length > 0 &&
    taskLogs?.hasMoreBefore,
  ),
);
</script>

<section class="flex h-full min-h-0 flex-col bg-background">
  {#if task}
    {#key task.id}
      <TaskLogToolbar
        {filter}
        onFilterChange={(next) => (filter = next)}
        matchCount={isTaskLogFilterActive(filter)
          ? visibleEvents.length
          : (taskLogs?.events.length ?? 0)}
        totalCount={taskLogs?.events.length ?? 0}
        {filterError}
        {follow}
        onFollowChange={(next) => (follow = next)}
        {wrap}
        onWrapChange={(next) => (wrap = next)}
        onCopy={() =>
          onCopyOutput?.(visibleEvents.map((event) => event.line).join("\n"))}
        {canSearchHistory}
        {searchingHistory}
        onSearchHistory={() =>
          onSearchHistory?.({
            text: filter.text.trim(),
            useRegex: filter.useRegex,
          })}
        {historyNotice}
        {onBackToLive}
      />
    {/key}
    {#if runItems.length > 1}
      <div class="flex items-center gap-2 border-b border-border px-3 py-2">
        <span class="shrink-0 text-xs text-muted-foreground">Run history</span>
        <SelectField
          items={runItems}
          value={task.id}
          ariaLabel="Selected task run"
          triggerClass="ml-auto max-w-72"
          onValueChange={(value: string) => onSelectRun?.(value)}
        />
      </div>
    {/if}
    {#if task.status === "recovered" || task.status === "recovery_unknown" || task.status === "orphaned"}
      <div
        class="border-b border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning"
      >
        {task.status === "recovered"
          ? "Process recovered after host restart. Captured output is frozen; stop or restart to resume supervised logs."
          : (task.error ??
            "Process identity could not be verified safely. Destructive PID actions are restricted.")}
        {#if task.runtime?.childPid}<span class="ml-2 font-mono"
            >PID {task.runtime.childPid}</span
          >{/if}
      </div>
    {/if}
    <div class="min-h-0 flex-1">
      {#key task.id}
        <TaskLogTerminal
          taskId={task.id}
          {taskLogs}
          command={task.command}
          {filter}
          {wrap}
          {follow}
          onFollowChange={(next) => (follow = next)}
          onVisibleEventsChange={(events) => (visibleEvents = events)}
          onFilterErrorChange={(error) => (filterError = error)}
          {onLoadEarlier}
        />
      {/key}
    </div>
  {:else}
    <div
      class="grid min-h-full place-content-center gap-1 text-center text-muted-foreground"
    >
      <Terminal class="mx-auto size-7 text-primary" strokeWidth={1.7} />
      <p class="mt-1 text-foreground">Task not found.</p>
      <span class="text-xs">
        The task may have been removed or is no longer available.
      </span>
    </div>
  {/if}
</section>
