<script lang="ts">
  import type { ManagedSandboxRecord } from "@nervekit/contracts";
  import TaskLogTerminal from "@nervekit/workbench-ui/tasks/TaskLogTerminal.svelte";
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
  const task = $derived(detail?.tasks.find((item) => item.id === taskId));
  const logs = $derived(detail?.taskLogsById[taskId]);

  $effect(() => {
    void store.refreshSandboxTaskLogs(record.sandboxId, taskId).catch(
      () => undefined,
    );
    const interval = window.setInterval(() => {
      void store.refreshSandboxTaskLogs(record.sandboxId, taskId).catch(
        () => undefined,
      );
    }, task && ["starting", "running", "ready", "stopping"].includes(task.status) ? 1500 : 5000);
    return () => window.clearInterval(interval);
  });
</script>

<TaskLogTerminal taskLogs={logs} command={task?.command} />
