<script lang="ts">
  import type {
    AgentRecord,
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
    homeDir?: string;
    exportUrl?: (kind: "json" | "md" | "html") => string | undefined;
    systemPromptUrl?: () => string | undefined;
    onTabChange?: (tab: UtilityTab) => void;
    onSelectAgent?: (agent: AgentRecord) => void;
    onNavigateToEntry?: (entryId: string | undefined, summarize?: boolean) => void;
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
    activeSession,
    activeAgent,
    sessionAgents = [],
    treeNodes = [],
    processes = [],
    selectedProcess,
    homeDir,
    exportUrl,
    systemPromptUrl,
    onTabChange,
    onSelectAgent,
    onNavigateToEntry,
    onCompact,
    onOpenProcessOutput,
    onStopProcess,
    onRestartProcess,
    onRemoveProcess,
    onPruneProcesses,
  }: Props = $props();

  const tabs = $derived<TabItem[]>([
    { value: "info", label: "Context" },
    { value: "processes", label: "Processes", count: processes.length },
    { value: "history", label: "History" },
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
        {activeSession}
        {activeAgent}
        {sessionAgents}
        {exportUrl}
        {systemPromptUrl}
        {onSelectAgent}
      />
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
      <HistoryTab {activeSession} {treeNodes} {onNavigateToEntry} {onCompact} />
    {/if}
  </ScrollArea>
</aside>
