<script lang="ts">
import ConfirmDialog from "@nervekit/ui-kit/components/ui/confirm-dialog";
import {
  PanelBanner,
  PanelHeader,
  PanelView,
} from "@nervekit/workbench-ui/panel";
import type { ContextUsage } from "@nervekit/contracts";
import type {
  AgentRecord,
  ConversationRecord,
  ProjectRecord,
  StatusResponse,
} from "$lib/api";
import ContextAgentsSection from "./ContextAgentsSection.svelte";
import ContextExportSection from "./ContextExportSection.svelte";
import ContextSummarySection from "./ContextSummarySection.svelte";
import ContextUsageSection from "./ContextUsageSection.svelte";

type Props = {
  status?: StatusResponse;
  contextUsage?: ContextUsage;
  contextWindow?: number;
  activeProject?: ProjectRecord;
  activeConversation?: ConversationRecord;
  activeAgent?: AgentRecord;
  conversationAgents?: AgentRecord[];
  compacting?: boolean;
  exportUrl?: (kind: "json" | "md" | "html") => string | undefined;
  systemPromptUrl?: () => string | undefined;
  onSelectAgent?: (agent: AgentRecord) => void;
  onCompact?: () => void;
};

let {
  status,
  contextUsage,
  contextWindow = 0,
  activeProject,
  activeConversation,
  activeAgent,
  conversationAgents = [],
  compacting = false,
  exportUrl,
  systemPromptUrl,
  onSelectAgent,
  onCompact,
}: Props = $props();

let confirmCompactOpen = $state(false);
</script>

<PanelView padded={false}>
  {#snippet banner()}
    <PanelHeader title="Context" />
    {#if !activeProject}
      <PanelBanner tone="muted">Select a project to view context.</PanelBanner>
    {/if}
  {/snippet}

  {#if activeProject}
    <ContextUsageSection
      {contextUsage}
      {contextWindow}
      {activeConversation}
      {compacting}
      onRequestCompact={() => (confirmCompactOpen = true)}
    />
    <ContextSummarySection
      {status}
      {activeProject}
      {activeConversation}
      {activeAgent}
    />
    <ContextAgentsSection {conversationAgents} {activeAgent} {onSelectAgent} />
    <ContextExportSection {activeConversation} {exportUrl} {systemPromptUrl} />
  {/if}
</PanelView>

<ConfirmDialog
  bind:open={confirmCompactOpen}
  title="Compact conversation"
  description="This summarizes earlier messages to reduce context size. The full history stays available in the branch tree."
  confirmLabel="Compact context"
  onConfirm={() => onCompact?.()}
/>
