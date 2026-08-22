<script lang="ts">
import type { AgentRecord } from "$lib/api";
import {
  compactActiveConversation,
  ConversationContextPanel,
  conversationSelectors,
} from "$lib/features/conversations";
import {
  GitPanel,
  type GitPanelActions,
  type GitPanelModel,
} from "$lib/features/git";
import ConversationsPanelHost from "$lib/app/composition/panels/ConversationsPanelHost.svelte";
import {
  cancelSelectedTask,
  cleanupTaskRuns,
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
} from "$lib/application/workspace";
import { responsive } from "$lib/app/shell/responsive.svelte";
import {
  activatePanelView,
  revealPanelView,
} from "$lib/app/shell/shell-layout.svelte";
import LazyViewPending from "$lib/app/shell/LazyViewPending.svelte";

// Panels that are not part of the default visible layout are code-split so
// their feature modules are not parsed during startup. The import fires when
// the panel is first activated.
let filesModule = $state<
  | Promise<{
      default: typeof import("$lib/features/filesystem/components/FilesPanelHost.svelte").default;
    }>
  | undefined
>();
let tasksModule = $state<
  | Promise<{
      default: typeof import("$lib/features/tasks/components/TasksPanelHost.svelte").default;
    }>
  | undefined
>();
let notesModule = $state<
  Promise<typeof import("$lib/features/scratch-notes")> | undefined
>();
let pullRequestsModule = $state<
  | Promise<{
      default: typeof import("$lib/features/git/ui/PullRequestsPanel.svelte").default;
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
const conversationUsage = $derived(
  conversationSelectors.activeConversationUsage,
);
const contextWindow = $derived(conversationSelectors.activeContextWindow);
const tasks = $derived(taskSelectors.scopedTasks);
const selectedTask = $derived(taskSelectors.activeCenterTask);

$effect(() => {
  if (viewId === "files")
    filesModule ??=
      import("$lib/features/filesystem/components/FilesPanelHost.svelte");
  else if (viewId === "tasks")
    tasksModule ??=
      import("$lib/features/tasks/components/TasksPanelHost.svelte");
  else if (viewId === "notes")
    notesModule ??= import("$lib/features/scratch-notes");
  else if (viewId === "pull-requests")
    pullRequestsModule ??=
      import("$lib/features/git/ui/PullRequestsPanel.svelte");
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
    <LazyViewPending />
  {:then module}
    {@const Component = module?.default}
    {#if Component}<Component {activeProject} />{/if}
  {/await}
{:else if viewId === "conversations"}
  <ConversationsPanelHost />
{:else if viewId === "git"}
  <GitPanel model={gitModel} actions={gitActions} />
{:else if viewId === "pull-requests"}
  {#await pullRequestsModule}
    <LazyViewPending />
  {:then module}
    {@const Component = module?.default}
    {#if Component}
      <Component model={gitModel} actions={gitActions} />
    {/if}
  {/await}
{:else if viewId === "context"}
  <ConversationContextPanel
    {status}
    {contextUsage}
    {conversationUsage}
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
    <LazyViewPending />
  {:then module}
    {@const Component = module?.NotesPanel}
    {#if Component}<Component {activeProject} />{/if}
  {/await}
{:else if viewId === "tasks"}
  {#await tasksModule}
    <LazyViewPending />
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
        onCleanupRuns={(ids) => void cleanupTaskRuns(ids)}
        onPruneTasks={() => void pruneFinishedTasks()}
        onRunCommand={(input) => {
          focusTasks();
          void runTaskCommand(input);
        }}
      />
    {/if}
  {/await}
{/if}
