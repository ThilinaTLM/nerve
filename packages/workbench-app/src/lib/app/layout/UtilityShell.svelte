<script lang="ts">
  import UtilityPanel from "$lib/app/layout/UtilityPanel.svelte";
  import { layout } from "$lib/app/layout/layout-state.svelte";
  import type { AgentRecord } from "$lib/api";
  import { conversationSelectors } from "$lib/features/conversations";
  import {
    openTaskTab,
    taskSelectors,
    pruneFinishedTasks,
    removeTask,
    restartSelectedTask,
    runTaskCommand,
    cancelSelectedTask,
  } from "$lib/features/tasks";
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
  const tasks = $derived(taskSelectors.scopedTasks);
  const selectedTask = $derived(taskSelectors.selectedTask);

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
  {tasks}
  {selectedTask}
  homeDir={status?.storage.home}
  {exportUrl}
  {systemPromptUrl}
  onTabChange={(tab) => (layout.utilityTab = tab)}
  onSelectAgent={selectAgent}
  onOpenTaskOutput={(id) => {
    layout.utilityTab = "tasks";
    void openTaskTab(id);
  }}
  onCancelTask={(id) => void cancelSelectedTask(id)}
  onRestartTask={(id) => void restartSelectedTask(id)}
  onRemoveTask={(id) => void removeTask(id)}
  onPruneTasks={() => void pruneFinishedTasks()}
  onRunCommand={(input) => {
    layout.utilityTab = "tasks";
    void (async () => {
      const task = await runTaskCommand(input);
      await openTaskTab(task.id);
    })();
  }}
/>
