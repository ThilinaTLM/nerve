<script lang="ts">
import type { AgentRecord } from "$lib/api";
import {
  compactActiveConversation,
  ContextPanelView,
  conversationSelectors,
} from "$lib/features/conversations";
import {
  GitPanelView,
  GitPullRequestsPanelView,
  type GitPanelActions,
  type GitPanelModel,
} from "$lib/presentation";
import { ConversationsPanelView } from "$lib/features/projects";
import { NotesPanelView } from "$lib/features/scratch-notes";
import {
  cancelSelectedTask,
  openTaskTab,
  pruneFinishedTasks,
  removeTask,
  restartSelectedTask,
  runTaskCommand,
  taskSelectors,
  TasksPanelView,
} from "$lib/features/tasks";
import {
  exportUrl,
  selection,
  systemPromptUrl,
  workspaceSelectors,
} from "$lib/features/workspace";
import { responsive } from "$lib/app/shell/responsive.svelte";
import {
  activatePanelView,
  revealPanelView,
} from "$lib/app/shell/shell-layout.svelte";

let {
  viewId,
  gitModel,
  gitActions,
}: {
  viewId: string;
  gitModel: GitPanelModel;
  gitActions: GitPanelActions;
} = $props();

const status = $derived(workspaceSelectors.status);
const activeProject = $derived(workspaceSelectors.activeProject);
const activeConversation = $derived(conversationSelectors.activeConversation);
const activeAgent = $derived(conversationSelectors.activeAgent);
const conversationAgents = $derived(conversationSelectors.conversationAgents);
const compacting = $derived(conversationSelectors.compacting);
const contextUsage = $derived(conversationSelectors.activeContextUsage);
const contextWindow = $derived(conversationSelectors.activeContextWindow);
const tasks = $derived(taskSelectors.scopedTasks);
const selectedTask = $derived(taskSelectors.selectedTask);

function selectAgent(agent: AgentRecord) {
  selection.agentId = agent.id;
  selection.projectId = agent.projectId;
  selection.conversationId = agent.conversationId;
  revealPanelView("context", responsive.isCompact);
}

function focusTasks() {
  revealPanelView("tasks", responsive.isCompact);
  activatePanelView("tasks");
}
</script>

{#if viewId === "conversations"}
  <ConversationsPanelView />
{:else if viewId === "git"}
  <GitPanelView model={gitModel} actions={gitActions} />
{:else if viewId === "pull-requests"}
  <GitPullRequestsPanelView model={gitModel} actions={gitActions} />
{:else if viewId === "context"}
  <ContextPanelView
    {status}
    {contextUsage}
    {contextWindow}
    {activeProject}
    {activeConversation}
    {activeAgent}
    {conversationAgents}
    {compacting}
    {exportUrl}
    {systemPromptUrl}
    onSelectAgent={selectAgent}
    onCompact={() => void compactActiveConversation()}
  />
{:else if viewId === "notes"}
  <NotesPanelView {activeProject} />
{:else if viewId === "tasks"}
  <TasksPanelView
    {activeProject}
    {tasks}
    {selectedTask}
    homeDir={status?.storage.home}
    onOpenTaskOutput={(id) => {
      focusTasks();
      void openTaskTab(id);
    }}
    onCancelTask={(id, request) => void cancelSelectedTask(id, request)}
    onRestartTask={(id) => void restartSelectedTask(id)}
    onRemoveTask={(id) => void removeTask(id)}
    onPruneTasks={() => void pruneFinishedTasks()}
    onRunCommand={(input) => {
      focusTasks();
      void runTaskCommand(input);
    }}
  />
{/if}
