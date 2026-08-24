import { modelKey } from "$lib/presentation/utils/model";
import { updateAgentConfig } from "$lib/api";
import { conversationState } from "$lib/features/conversations/state/conversation-state.svelte";
import { notify } from "$lib/application/notifications/notify.svelte";
import { upsertAgentRecordFresh } from "$lib/application/workspace/entity-reducers";
import { selection } from "$lib/application/workspace/selection.svelte";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";
import {
  AgentConfigMutationQueue,
  type AgentConfigPatch,
} from "./agent-config-mutation-queue";

/**
 * Reactive desired-config overrides per agent. While a mutation is pending,
 * the override is the display value for that agent's composer controls, so
 * delayed authoritative snapshots and events cannot undo a newer local
 * intent. The authoritative agent cache still receives every returned record.
 */
const overrides = $state<{ byAgentId: Record<string, AgentConfigPatch> }>({
  byAgentId: {},
});

const queue = new AgentConfigMutationQueue({
  configure: (agentId, patch) => updateAgentConfig(agentId, patch),
  onDesiredChanged: (agentId, desired) => {
    if (desired) overrides.byAgentId[agentId] = desired;
    else delete overrides.byAgentId[agentId];
  },
  onAgentRecord: (agent) => {
    upsertAgentRecordFresh(agent);
  },
  onConfirmed: (agentId, agent) => {
    if (selection.agentId !== agentId) return;
    // Reconcile the composer to the server-clamped values.
    if (agent.model) conversationState.selectedModelKey = modelKey(agent.model);
    conversationState.selectedThinkingLevel = agent.thinkingLevel;
    conversationState.selectedMode = agent.mode;
    conversationState.selectedPermissionLevel = agent.permissionLevel;
  },
  onFailed: (agentId, error) => {
    const confirmed = workspaceState.agents.find(
      (agent) => agent.id === agentId,
    );
    if (confirmed && selection.agentId === agentId) {
      // Roll back to the latest confirmed agent record.
      if (confirmed.model) {
        conversationState.selectedModelKey = modelKey(confirmed.model);
      }
      conversationState.selectedThinkingLevel = confirmed.thinkingLevel;
      conversationState.selectedMode = confirmed.mode;
      conversationState.selectedPermissionLevel = confirmed.permissionLevel;
    }
    const description = error instanceof Error ? error.message : String(error);
    notify.error("Could not update agent settings", { description });
  },
});

/** Publishes a local intent immediately and schedules the serialized RPCs. */
export function queueAgentConfigChange(
  agentId: string,
  patch: AgentConfigPatch,
): void {
  queue.enqueue(agentId, patch);
}

/** Waits for the agent's pending config mutations to settle (never throws). */
export function flushAgentConfigChanges(agentId: string): Promise<void> {
  return queue.flush(agentId);
}

/** The pending desired override for an agent, if a mutation is in flight. */
export function agentConfigOverride(
  agentId: string | undefined,
): AgentConfigPatch | undefined {
  return agentId ? overrides.byAgentId[agentId] : undefined;
}
