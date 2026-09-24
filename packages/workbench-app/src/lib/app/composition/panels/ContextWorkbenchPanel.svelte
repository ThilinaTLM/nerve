<script lang="ts">
import type { AgentRecord } from "$lib/api";
import {
  compactActiveConversation,
  ConversationContextPanel,
  conversationSelectors,
} from "$lib/features/conversations";
import { agentRowLabel } from "$lib/features/conversations/views/context-agent-rows";
import {
  exportUrl,
  selection,
  systemPromptUrl,
  workspaceSelectors,
} from "$lib/application/workspace";
import { responsive } from "$lib/app/shell/responsive.svelte";
import { revealPanelView } from "$lib/app/shell/shell-layout.svelte";
import { setConversationUiCapabilities } from "$lib/presentation/context.svelte";
import SubagentTranscriptDialog from "$lib/presentation/tools/tool-call/SubagentTranscriptDialog.svelte";
import { workbenchConversationUiCapabilities } from "../conversations/conversation-capabilities.svelte";

// The transcript dialog renders tool cards that read conversation capabilities.
setConversationUiCapabilities(workbenchConversationUiCapabilities());

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

let transcriptAgent = $state<AgentRecord>();
let transcriptOpen = $state(false);

function selectAgent(agent: AgentRecord) {
  selection.agentId = agent.id;
  selection.projectId = agent.projectId;
  selection.conversationId = agent.conversationId;
  revealPanelView("context", responsive.isCompact);
}

function openTranscript(agent: AgentRecord) {
  if (!agent.parentAgentId) return;
  transcriptAgent = agent;
  transcriptOpen = true;
}
</script>

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
  onOpenTranscript={openTranscript}
  onCompact={() => void compactActiveConversation()}
/>

{#if transcriptAgent}
  <SubagentTranscriptDialog
    bind:open={transcriptOpen}
    parentAgentId={transcriptAgent.parentAgentId}
    childAgentId={transcriptAgent.id}
    label={agentRowLabel(transcriptAgent)}
  />
{/if}
