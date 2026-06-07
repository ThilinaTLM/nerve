<script lang="ts">
  import GitBranch from "@lucide/svelte/icons/git-branch";
  import History from "@lucide/svelte/icons/history";
  import Info from "@lucide/svelte/icons/info";
  import Terminal from "@lucide/svelte/icons/terminal";
  import type {
    AgentRecord,
    ConversationEntry,
    ProcessRecord,
    ProjectRecord,
    ConversationRecord,
    ConversationTreeNode,
    StatusResponse,
    ToolCallRecord,
  } from "../../api";
  import { ScrollArea } from "$lib/components/ui/scroll-area";
  import Tabs, { type TabItem } from "$lib/components/ui/tabs-bar";
  import ContextTab from "./utility/ContextTab.svelte";
  import GitTab from "./utility/GitTab.svelte";
  import HistoryTab from "./utility/HistoryTab.svelte";
  import ProcessesTab from "./utility/ProcessesTab.svelte";
  import "./utility/utility.css";

  type UtilityTab = "history" | "processes" | "info" | "git";

  type Props = {
    activeTab?: UtilityTab;
    status?: StatusResponse;
    activeProject?: ProjectRecord;
    activeConversation?: ConversationRecord;
    activeAgent?: AgentRecord;
    conversationAgents?: AgentRecord[];
    treeNodes?: ConversationTreeNode[];
    toolCalls?: ToolCallRecord[];
    processes?: ProcessRecord[];
    selectedProcess?: ProcessRecord;
    homeDir?: string;
    exportUrl?: (kind: "json" | "md" | "html") => string | undefined;
    systemPromptUrl?: () => string | undefined;
    onTabChange?: (tab: UtilityTab) => void;
    onSelectAgent?: (agent: AgentRecord) => void;
    onNavigateToEntry?: (entryId: string | undefined, summarize?: boolean) => void;
    onEditEntry?: (entry: ConversationEntry) => void;
    onCompact?: () => void;
    onOpenProcessOutput?: (id: string) => void;
    onStopProcess?: (id: string) => void;
    onRestartProcess?: (id: string) => void;
    onRemoveProcess?: (id: string) => void;
    onPruneProcesses?: () => void;
  };

  let {
    activeTab = $bindable<UtilityTab>("info"),
    status,
    activeProject,
    activeConversation,
    activeAgent,
    conversationAgents = [],
    treeNodes = [],
    toolCalls = [],
    processes = [],
    selectedProcess,
    homeDir,
    exportUrl,
    systemPromptUrl,
    onTabChange,
    onSelectAgent,
    onNavigateToEntry,
    onEditEntry,
    onCompact,
    onOpenProcessOutput,
    onStopProcess,
    onRestartProcess,
    onRemoveProcess,
    onPruneProcesses,
  }: Props = $props();

  const tabs = $derived<TabItem[]>([
    { value: "info", label: "Context", icon: Info },
    { value: "git", label: "Git", icon: GitBranch },
    { value: "processes", label: "Processes", icon: Terminal, count: processes.length },
    { value: "history", label: "History", icon: History },
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
        {processes}
        {selectedProcess}
        {homeDir}
        {onOpenProcessOutput}
        {onStopProcess}
        {onRestartProcess}
        {onRemoveProcess}
        {onPruneProcesses}
      />
    {:else}
      <HistoryTab {activeConversation} {treeNodes} {toolCalls} {onNavigateToEntry} {onEditEntry} {onCompact} />
    {/if}
  </ScrollArea>
</aside>
