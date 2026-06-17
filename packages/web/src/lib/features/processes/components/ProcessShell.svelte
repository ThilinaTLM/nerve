<script lang="ts">
  import ProcessOutputPane from "$lib/features/processes/components/ProcessOutputPane.svelte";
  import { processSelectors } from "$lib/features/processes/state/process-selectors.svelte";
  import { workspaceSelectors } from "$lib/features/workspace/state/workspace-selectors.svelte";
  import {
    refreshProcessLogs,
    restartSelectedProcess,
    stopSelectedProcess,
  } from "$lib/stores/workbench.svelte";

  const status = $derived(workspaceSelectors.status);
  const processLogs = $derived(processSelectors.processLogs);
  const activeCenterProcess = $derived(processSelectors.activeCenterProcess);
</script>

<ProcessOutputPane
  process={activeCenterProcess}
  {processLogs}
  homeDir={status?.storage.home}
  onRefresh={() => void refreshProcessLogs()}
  onRestart={(id) => void restartSelectedProcess(id)}
  onStop={(id) => void stopSelectedProcess(id)}
/>
