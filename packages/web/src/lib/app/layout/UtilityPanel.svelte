<script lang="ts">
  import GitBranch from "@lucide/svelte/icons/git-branch";
  import Info from "@lucide/svelte/icons/info";
  import Terminal from "@lucide/svelte/icons/terminal";
  import type {
    AgentRecord,
    ConversationRecord,
    ProcessRecord,
    ProjectRecord,
    StatusResponse,
  } from "$lib/api";
  import { ScrollArea } from "$lib/components/ui/scroll-area";
  import Tabs, { type TabItem } from "$lib/components/ui/tabs-bar";
  import ContextTab from "$lib/features/conversations/components/ContextUtilityPanel.svelte";
  import GitTab from "$lib/features/git/components/GitUtilityPanel.svelte";
  import ProcessesTab from "$lib/features/processes/components/ProcessUtilityPanel.svelte";

  type UtilityTab = "processes" | "info" | "git";

  type Props = {
    activeTab?: UtilityTab;
    status?: StatusResponse;
    activeProject?: ProjectRecord;
    activeConversation?: ConversationRecord;
    activeAgent?: AgentRecord;
    conversationAgents?: AgentRecord[];
    processes?: ProcessRecord[];
    selectedProcess?: ProcessRecord;
    homeDir?: string;
    exportUrl?: (kind: "json" | "md" | "html") => string | undefined;
    systemPromptUrl?: () => string | undefined;
    onTabChange?: (tab: UtilityTab) => void;
    onSelectAgent?: (agent: AgentRecord) => void;
    onOpenProcessOutput?: (id: string) => void;
    onStopProcess?: (id: string) => void;
    onRestartProcess?: (id: string) => void;
    onRemoveProcess?: (id: string) => void;
    onPruneProcesses?: () => void;
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
    processes = [],
    selectedProcess,
    homeDir,
    exportUrl,
    systemPromptUrl,
    onTabChange,
    onSelectAgent,
    onOpenProcessOutput,
    onStopProcess,
    onRestartProcess,
    onRemoveProcess,
    onPruneProcesses,
    onRunCommand,
  }: Props = $props();

  const ACTIVE_PROCESS_STATUSES = new Set(["starting", "running", "ready", "stopping"]);
  const runningProcessCount = $derived(
    processes.filter((process) => ACTIVE_PROCESS_STATUSES.has(process.status)).length,
  );

  const tabs = $derived<TabItem[]>([
    { value: "git", label: "Git", icon: GitBranch },
    { value: "processes", label: "Processes", icon: Terminal, count: runningProcessCount },
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
    {:else if activeTab === "processes"}
      <ProcessesTab
        {activeProject}
        {processes}
        {selectedProcess}
        {homeDir}
        {onOpenProcessOutput}
        {onStopProcess}
        {onRestartProcess}
        {onRemoveProcess}
        {onPruneProcesses}
        {onRunCommand}
      />
    {/if}
  </ScrollArea>
</aside>
