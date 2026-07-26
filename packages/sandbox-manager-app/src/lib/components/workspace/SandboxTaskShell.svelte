<script lang="ts">
import type { ManagedSandboxRecord } from "@nervekit/contracts";
import { TaskOutputPane } from "@nervekit/workbench-ui/tasks";
import { useSandboxManagerStore } from "../../state/sandbox-manager-state.svelte";

let {
  record,
  taskId,
}: {
  record: ManagedSandboxRecord;
  taskId: string;
} = $props();

const store = useSandboxManagerStore();
const detail = $derived(store.details[record.sandboxId]);
let selectedRunOverride = $state<string>();
const selectedRunId = $derived(selectedRunOverride ?? taskId);
const initialTask = $derived(detail?.tasks.find((item) => item.id === taskId));
const entryId = $derived(
  initialTask?.definitionId ?? initialTask?.restartRootTaskId ?? taskId,
);
const runs = $derived(
  detail?.tasks.filter(
    (item) =>
      (item.definitionId ?? item.restartRootTaskId ?? item.id) === entryId,
  ) ?? [],
);
const task = $derived(
  runs.find((item) => item.id === selectedRunId) ?? runs[0] ?? initialTask,
);
const logs = $derived(task ? detail?.taskLogsById[task.id] : undefined);

$effect(() => {
  void store
    .refreshSandboxTaskLogs(record.sandboxId, task?.id ?? taskId)
    .catch(() => undefined);
  const interval = window.setInterval(
    () => {
      void store
        .refreshSandboxTaskLogs(record.sandboxId, task?.id ?? taskId)
        .catch(() => undefined);
    },
    task && ["starting", "running", "ready", "stopping"].includes(task.status)
      ? 1500
      : 5000,
  );
  return () => window.clearInterval(interval);
});
</script>

<TaskOutputPane
  {task}
  {runs}
  taskLogs={logs}
  onSelectRun={(taskId) => (selectedRunOverride = taskId)}
  onLoadEarlier={() =>
    task
      ? store.loadEarlierSandboxTaskLogs(record.sandboxId, task.id)
      : Promise.resolve()}
/>
