<script lang="ts">
  import type {
    AgentRecord,
    ProcessLogQueryResponse,
    ProcessRecord,
    ProjectRecord,
    SessionRecord,
    SessionTreeNode,
    StatusResponse,
  } from "../../api";
  import { ScrollArea } from "$lib/components/ui/scroll-area";
  import Tabs, { type TabItem } from "$lib/components/ui/tabs-bar";
  import ContextTab from "./utility/ContextTab.svelte";
  import HistoryTab from "./utility/HistoryTab.svelte";
  import ProcessesTab from "./utility/ProcessesTab.svelte";
  import "./utility/utility.css";

  type UtilityTab = "history" | "processes" | "info";

  type Props = {
    activeTab?: UtilityTab;
    status?: StatusResponse;
    activeProject?: ProjectRecord;
    activeSession?: SessionRecord;
    activeAgent?: AgentRecord;
    sessionAgents?: AgentRecord[];
    treeNodes?: SessionTreeNode[];
    processes?: ProcessRecord[];
    selectedProcess?: ProcessRecord;
    processLogs?: ProcessLogQueryResponse;
    exportUrl?: (kind: "json" | "md" | "html") => string | undefined;
    onTabChange?: (tab: UtilityTab) => void;
    onSelectAgent?: (agent: AgentRecord) => void;
    onNavigateToEntry?: (entryId: string | undefined, summarize?: boolean) => void;
    onCompact?: () => void;
    onSelectProcess?: (id: string) => void;
    onRefreshProcessLogs?: () => void;
    onStopProcess?: (id: string) => void;
    onRestartProcess?: (id: string) => void;
  };

  let {
    activeTab = $bindable<UtilityTab>("history"),
    status,
    activeProject,
    activeSession,
    activeAgent,
    sessionAgents = [],
    treeNodes = [],
    processes = [],
    selectedProcess,
    processLogs,
    exportUrl,
    onTabChange,
    onSelectAgent,
    onNavigateToEntry,
    onCompact,
    onSelectProcess,
    onRefreshProcessLogs,
    onStopProcess,
    onRestartProcess,
  }: Props = $props();

  const tabs = $derived<TabItem[]>([
    { value: "history", label: "History" },
    { value: "processes", label: "Processes", count: processes.length },
    { value: "info", label: "Context" },
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
    {#if activeTab === "history"}
      <HistoryTab {activeSession} {treeNodes} {onNavigateToEntry} {onCompact} />
    {:else if activeTab === "processes"}
      <ProcessesTab
        {processes}
        {selectedProcess}
        {processLogs}
        {onSelectProcess}
        {onRefreshProcessLogs}
        {onStopProcess}
        {onRestartProcess}
      />
    {:else}
      <ContextTab
        {status}
        {activeProject}
        {activeSession}
        {activeAgent}
        {sessionAgents}
        {exportUrl}
        {onSelectAgent}
      />
    {/if}
  </ScrollArea>
</aside>
