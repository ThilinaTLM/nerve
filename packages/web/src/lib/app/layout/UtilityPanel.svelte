<script lang="ts">
  import GitBranch from "@lucide/svelte/icons/git-branch";
  import Info from "@lucide/svelte/icons/info";
  import Terminal from "@lucide/svelte/icons/terminal";
  import type {
    AgentRecord,
    ConversationRecord,
    TaskRecord,
    ProjectRecord,
    StatusResponse,
  } from "$lib/api";
  import { ScrollArea } from "@nervekit/ui/components/ui/scroll-area";
  import Tabs, { type TabItem } from "@nervekit/ui/components/ui/tabs-bar";
  import ContextTab from "$lib/features/conversations/components/ContextUtilityPanel.svelte";
  import GitTab from "$lib/features/git/components/GitUtilityPanel.svelte";
  import TasksTab from "$lib/features/tasks/components/TaskUtilityPanel.svelte";

  type UtilityTab = "tasks" | "info" | "git";

  type Props = {
    activeTab?: UtilityTab;
    status?: StatusResponse;
    activeProject?: ProjectRecord;
    activeConversation?: ConversationRecord;
    activeAgent?: AgentRecord;
    conversationAgents?: AgentRecord[];
    tasks?: TaskRecord[];
    selectedTask?: TaskRecord;
    homeDir?: string;
    exportUrl?: (kind: "json" | "md" | "html") => string | undefined;
    systemPromptUrl?: () => string | undefined;
    onTabChange?: (tab: UtilityTab) => void;
    onSelectAgent?: (agent: AgentRecord) => void;
    onOpenTaskOutput?: (id: string) => void;
    onCancelTask?: (id: string) => void;
    onRestartTask?: (id: string) => void;
    onRemoveTask?: (id: string) => void;
    onPruneTasks?: () => void;
    onRunCommand?: (input: {
      projectId: string;
      cwd: string;
      command: string;
      name?: string;
    }) => void;
  };

  let {
    activeTab = $bindable<UtilityTab>("git"),
    status,
    activeProject,
    activeConversation,
    activeAgent,
    conversationAgents = [],
    tasks = [],
    selectedTask,
    homeDir,
    exportUrl,
    systemPromptUrl,
    onTabChange,
    onSelectAgent,
    onOpenTaskOutput,
    onCancelTask,
    onRestartTask,
    onRemoveTask,
    onPruneTasks,
    onRunCommand,
  }: Props = $props();

  const ACTIVE_TASK_STATUSES = new Set(["starting", "running", "ready", "stopping"]);
  const runningTaskCount = $derived(
    tasks.filter((task) => ACTIVE_TASK_STATUSES.has(task.status)).length,
  );

  const tabs = $derived<TabItem[]>([
    { value: "git", label: "Git", icon: GitBranch },
    { value: "tasks", label: "Tasks", icon: Terminal, count: runningTaskCount },
    { value: "info", label: "Context", icon: Info },
  ]);

  function setTab(tab: string) {
    activeTab = tab as UtilityTab;
    onTabChange?.(activeTab);
  }
</script>

<aside class="utility-panel">
  <div class="utility-tabs">
    <Tabs tabs={tabs} bind:value={activeTab} ariaLabel="Utility panel tabs" onValueChange={setTab} />
  </div>

  <ScrollArea class="utility-scroll" viewportClass="utility-content" type="auto">
    {#if activeTab === "info"}
      <ContextTab
        {status}
        {activeProject}
        {activeConversation}
        {activeAgent}
        {conversationAgents}
        {exportUrl}
        {systemPromptUrl}
        {onSelectAgent}
      />
    {:else if activeTab === "git"}
      <GitTab {activeProject} {activeAgent} />
    {:else if activeTab === "tasks"}
      <TasksTab
        {activeProject}
        {tasks}
        {selectedTask}
        {homeDir}
        {onOpenTaskOutput}
        {onCancelTask}
        {onRestartTask}
        {onRemoveTask}
        {onPruneTasks}
        {onRunCommand}
      />
    {/if}
  </ScrollArea>
</aside>
