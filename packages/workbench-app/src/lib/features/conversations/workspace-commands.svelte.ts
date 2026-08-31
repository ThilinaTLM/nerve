import type { AgentRecord } from "$lib/api";
import {
  conversationViewKey,
  pendingConversationKey,
} from "$lib/domain/navigation/view-keys";
import { agentConfigOverride } from "./state/agent-config-overrides.svelte";
import { conversationState } from "./state/conversation-state.svelte";

export const conversationWorkspaceCommands = {
  setOpenConversationTabIds(ids: string[]): void {
    conversationState.openConversationTabIds = ids;
  },
  setSlashCompletions(
    completions: typeof conversationState.slashCompletions,
  ): void {
    conversationState.slashCompletions = completions;
  },
  discardConversationView(id: string): void {
    delete conversationState.conversationViews[conversationViewKey(id)];
  },
  discardPendingConversation(id: string): void {
    delete conversationState.pendingConversations[pendingConversationKey(id)];
  },
  setActiveConversationTab(id: string | undefined): void {
    conversationState.activeConversationTabId = id;
  },
  applyAgentConfiguration(agent: AgentRecord): void {
    const override = agentConfigOverride(agent.id);
    conversationState.selectedModelKey = override?.model
      ? `${override.model.provider}:${override.model.modelId}`
      : agent.model
        ? `${agent.model.provider}:${agent.model.modelId}`
        : conversationState.selectedModelKey;
    conversationState.selectedThinkingLevel =
      override?.thinkingLevel ?? agent.thinkingLevel;
    conversationState.selectedMode = override?.mode ?? agent.mode;
    conversationState.selectedPermissionLevel =
      override?.permissionLevel ?? agent.permissionLevel;
    conversationState.selectedPermissionRuleSetId =
      override?.permissionRuleSetId ??
      agent.permissionRuleSetId ??
      agent.permissionLevel;
  },
  applyConversationConfiguration(input: {
    mode: typeof conversationState.selectedMode;
    permissionLevel: typeof conversationState.selectedPermissionLevel;
    permissionRuleSetId?: string;
  }): void {
    conversationState.selectedMode = input.mode;
    conversationState.selectedPermissionLevel = input.permissionLevel;
    conversationState.selectedPermissionRuleSetId =
      input.permissionRuleSetId ?? input.permissionLevel;
  },
  agentConfigOverride,
};
