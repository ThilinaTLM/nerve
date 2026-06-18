<script lang="ts">
  import UtilityPanel from "$lib/app/layout/UtilityPanel.svelte";
  import { layout } from "$lib/app/layout/layout-state.svelte";
  import type { AgentRecord } from "$lib/api";
  import { conversationSelectors } from "$lib/features/conversations";
  import {
    openProcessTab,
    processSelectors,
    pruneStoppedProcesses,
    removeProcess,
    restartSelectedProcess,
    runProcessCommand,
    stopSelectedProcess,
  } from "$lib/features/processes";
  import {
    exportUrl,
    selection,
    systemPromptUrl,
    workspaceSelectors,
  } from "$lib/features/workspace";

  const status = $derived(workspaceSelectors.status);
  const activeProject = $derived(workspaceSelectors.activeProject);
  const activeConversation = $derived(conversationSelectors.activeConversation);
  const activeAgent = $derived(conversationSelectors.activeAgent);
  const conversationAgents = $derived(conversationSelectors.conversationAgents);
  const processes = $derived(processSelectors.scopedProcesses);
  const selectedProcess = $derived(processSelectors.selectedProcess);

  function selectAgent(agent: AgentRecord) {
    selection.agentId = agent.id;
    selection.projectId = agent.projectId;
    selection.conversationId = agent.conversationId;
    layout.utilityTab = "info";
  }
</script>

<UtilityPanel
  activeTab={layout.utilityTab}
  {status}
  {activeProject}
  {activeConversation}
  {activeAgent}
  {conversationAgents}
  {processes}
  {selectedProcess}
  homeDir={status?.storage.home}
  {exportUrl}
  {systemPromptUrl}
  onTabChange={(tab) => (layout.utilityTab = tab)}
  onSelectAgent={selectAgent}
  onOpenProcessOutput={(id) => {
    layout.utilityTab = "processes";
    void openProcessTab(id);
  }}
  onStopProcess={(id) => void stopSelectedProcess(id)}
  onRestartProcess={(id) => void restartSelectedProcess(id)}
  onRemoveProcess={(id) => void removeProcess(id)}
  onPruneProcesses={() => void pruneStoppedProcesses()}
  onRunCommand={(input) => {
    layout.utilityTab = "processes";
    void (async () => {
      const process = await runProcessCommand(input);
      await openProcessTab(process.id);
    })();
  }}
/>
