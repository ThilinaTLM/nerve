<script lang="ts">
import type { AgentRecord } from "$lib/api";
import {
  compactActiveConversation,
  ConversationContextPanel,
  conversationSelectors,
} from "$lib/features/conversations";
import {
  exportUrl,
  selection,
  systemPromptUrl,
  workspaceSelectors,
} from "$lib/application/workspace";
import { responsive } from "$lib/app/shell/responsive.svelte";
import { revealPanelView } from "$lib/app/shell/shell-layout.svelte";

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

function selectAgent(agent: AgentRecord) {
  selection.agentId = agent.id;
  selection.projectId = agent.projectId;
  selection.conversationId = agent.conversationId;
  revealPanelView("context", responsive.isCompact);
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
  onCompact={() => void compactActiveConversation()}
/>
