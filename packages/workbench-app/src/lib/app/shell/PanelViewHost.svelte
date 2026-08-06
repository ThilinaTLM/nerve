<script lang="ts">
import type { AgentRecord } from "$lib/api";
import {
  compactActiveConversation,
  ContextPanelView,
  conversationSelectors,
} from "$lib/features/conversations";
import {
  GitPanelView,
  type GitPanelActions,
  type GitPanelModel,
} from "$lib/presentation";
import { ConversationsPanelView } from "$lib/features/projects";
import {
  cancelSelectedTask,
  openTaskTab,
  pruneFinishedTasks,
  removeTask,
  restartSelectedTask,
  runTaskCommand,
  taskSelectors,
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
import LazyShellPending from "$lib/app/shell/LazyShellPending.svelte";

// Panels that are not part of the default visible layout are code-split so
// their feature modules are not parsed during startup. The import fires when
// the panel is first activated.
let filesModule = $state<
  Promise<typeof import("$lib/features/filesystem")> | undefined
>();
let tasksModule = $state<
  | Promise<{
      default: typeof import("$lib/features/tasks/components/TasksPanelView.svelte").default;
    }>
  | undefined
>();
let notesModule = $state<
  Promise<typeof import("$lib/features/scratch-notes")> | undefined
>();
let pullRequestsModule = $state<
  | Promise<{
      default: typeof import("$lib/presentation/git/GitPullRequestsPanelView.svelte").default;
    }>
  | undefined
>();

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

$effect(() => {
  if (viewId === "files") filesModule ??= import("$lib/features/filesystem");
  else if (viewId === "tasks")
    tasksModule ??=
      import("$lib/features/tasks/components/TasksPanelView.svelte");
  else if (viewId === "notes")
    notesModule ??= import("$lib/features/scratch-notes");
  else if (viewId === "pull-requests")
    pullRequestsModule ??=
      import("$lib/presentation/git/GitPullRequestsPanelView.svelte");
});

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

{#if viewId === "files"}
  {#await filesModule}
    <LazyShellPending />
  {:then module}
    {@const Component = module?.FilesPanelView}
    {#if Component}<Component {activeProject} />{/if}
  {/await}
{:else if viewId === "conversations"}
  <ConversationsPanelView />
{:else if viewId === "git"}
  <GitPanelView model={gitModel} actions={gitActions} />
{:else if viewId === "pull-requests"}
  {#await pullRequestsModule}
    <LazyShellPending />
  {:then module}
    {@const Component = module?.default}
    {#if Component}
      <Component model={gitModel} actions={gitActions} />
    {/if}
  {/await}
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
  {#await notesModule}
    <LazyShellPending />
  {:then module}
    {@const Component = module?.NotesPanelView}
    {#if Component}<Component {activeProject} />{/if}
  {/await}
{:else if viewId === "tasks"}
  {#await tasksModule}
    <LazyShellPending />
  {:then module}
    {@const Component = module?.default}
    {#if Component}
      <Component
        {activeProject}
        {tasks}
        {selectedTask}
        homeDir={status?.storage.userHome}
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
  {/await}
{/if}
