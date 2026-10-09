<script lang="ts">
import type { ConversationSnapshot } from "@nervekit/contracts/core";
import { requestConversation } from "$lib/application/startup/conversation-connection";
import type { AgentRecord } from "$lib/presentation/view-models/conversation";
import { retainConversationStore } from "$lib/features/conversations/state/open-conversation-stores";
import type { ConversationStore } from "$lib/features/conversations/state/core-conversation-store.svelte";
import {
  conversationContext,
  projectView,
} from "$lib/features/conversations/adapters/core-context.adapter";
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import { summarizeConversationUsage } from "$lib/presentation/usage/conversation-usage";
import { ConversationContextPanel } from "$lib/features/conversations";
import { agentRowLabel } from "$lib/features/conversations/views/context-agent-rows";
import { selection, workspaceSelectors } from "$lib/application/workspace";
import { responsive } from "$lib/app/shell/responsive.svelte";
import { revealPanelView } from "$lib/app/shell/shell-layout.svelte";
import { setConversationUiCapabilities } from "$lib/presentation/context.svelte";
import SubagentTranscriptDialog from "$lib/presentation/tools/tool-call/SubagentTranscriptDialog.svelte";
import { workbenchConversationUiCapabilities } from "../conversations/conversation-capabilities.svelte";

// The transcript dialog renders tool cards that read conversation capabilities.
setConversationUiCapabilities(workbenchConversationUiCapabilities());

let store = $state<ConversationStore>();
let selectedAgentId = $state<string>();
$effect(() => {
  const id = selection.conversationId;
  selectedAgentId = undefined;
  store = undefined;
  if (!id) return;
  const retained = retainConversationStore(id);
  store = retained.store;
  void retained.ready.catch(() => undefined);
  return retained.release;
});
const status = $derived(workspaceSelectors.status);
const activeProject = $derived(
  workspaceSelectors.activeProject
    ? projectView(workspaceSelectors.activeProject!)
    : undefined,
);
let childSnapshots = $state<Record<string, ConversationSnapshot>>({});
$effect(() => {
  const snapshot = store?.snapshot;
  childSnapshots = {};
  if (!snapshot) return;
  let current = true;
  void Promise.all(
    snapshot.children.map(
      async (child) =>
        [
          child.id,
          await requestConversation("conversation.getSnapshot", {
            conversationId: child.id,
          }),
        ] as const,
    ),
  )
    .then((children) => {
      if (current) childSnapshots = Object.fromEntries(children);
    })
    .catch(() => undefined);
  return () => {
    current = false;
  };
});
const context = $derived(
  store?.snapshot
    ? conversationContext(
        store.snapshot,
        store.events,
        settingsState.models,
        childSnapshots,
      )
    : undefined,
);
const activeConversation = $derived(context?.activeConversation);
const activeAgent = $derived(
  context?.conversationAgents.find((agent) => agent.id === selectedAgentId) ??
    context?.activeAgent,
);
const conversationAgents = $derived(context?.conversationAgents ?? []);
const agentActivities = $derived(context?.agentActivities ?? {});
let compacting = $state(false);
const contextUsage = $derived(context?.contextUsage);
const conversationUsage = $derived(
  context?.conversationUsage ?? summarizeConversationUsage([]),
);
const contextWindow = $derived(context?.contextWindow ?? 0);
async function compactActiveConversation() {
  compacting = true;
  try {
    await store?.control("compact");
  } finally {
    compacting = false;
  }
}
const exportUrl: (kind: "json" | "md" | "html") => string | undefined = () =>
  undefined;
const systemPromptUrl = (): string | undefined => undefined;

let transcriptAgent = $state<AgentRecord>();
let transcriptOpen = $state(false);

function selectAgent(agent: AgentRecord) {
  selectedAgentId = agent.id;
  selection.projectId = agent.projectId;
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
  {agentActivities}
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
