import { historyExecutionError } from "./history-health";
import type {
  AgentRecord,
  UpdateAgentRequest,
} from "@nervekit/contracts/agents";
import { protocolRequest } from "@nervekit/protocol/adapters";
import { upsertAgentRecordFresh } from "$lib/application/workspace/entity-reducers";
import { notify } from "$lib/application/notifications/notify.svelte";
import { flushAgentConfigChanges } from "./agent-config-mutations.svelte";
import {
  conversationState,
  type ConversationViewState,
} from "./conversation-state.svelte";
import { agentUsesConversationView } from "./agent-history-ownership";
import { conversationViewKey } from "$lib/domain/navigation/view-keys";
import { ensureAgentView, refreshAgentView } from "./agent-selection.svelte";

/** Read without creating state inside a reactive derivation. */
export function agentSettingsView(
  agent: AgentRecord,
): ConversationViewState | undefined {
  return agentUsesConversationView(agent)
    ? conversationState.conversationViews[
        conversationViewKey(agent.conversationId)
      ]
    : conversationState.agentViews[agent.id];
}

export async function saveAgentSettings(
  agent: AgentRecord,
  patch: UpdateAgentRequest,
): Promise<void> {
  await flushAgentConfigChanges(agent.id);
  const { result } = await protocolRequest("agent.configure", {
    agentId: agent.id,
    ...patch,
  });
  upsertAgentRecordFresh(result.agent);
  await refreshAgentView(agent);
}

/** Use this actor's draft, never the globally selected conversation's draft. */
export async function interruptAgentWithDraft(
  agent: AgentRecord,
): Promise<void> {
  const view = ensureAgentView(agent);
  const text = view.composerText.trim();
  if (!text || view.stopping || historyExecutionError(view, agent.id)) return;
  view.stopping = true;
  view.error = undefined;
  try {
    await protocolRequest(
      "agent.interrupt",
      { agentId: agent.id, text },
      {
        idempotencyKey: crypto.randomUUID(),
      },
    );
    // Do not erase edits made while the replacement was being accepted.
    if (view.composerText.trim() === text) view.composerText = "";
    const { result } = await protocolRequest("agent.get", {
      agentId: agent.id,
    });
    upsertAgentRecordFresh(result.agent);
    await refreshAgentView(result.agent);
  } catch (caught) {
    view.error = caught instanceof Error ? caught.message : String(caught);
    notify.error("Interrupt failed", { description: view.error });
  } finally {
    view.stopping = false;
  }
}
