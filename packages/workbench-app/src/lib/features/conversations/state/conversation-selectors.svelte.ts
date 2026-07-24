import {
  modelKey,
  parseModelKey,
  scopedUsableModelOptions,
} from "@nervekit/workbench-ui/core/utils/model";
import { activeRunStreamingText } from "@nervekit/workbench-ui/state";
import {
  conversationViewKey,
  pendingConversationKey,
} from "$lib/core/state/state-keys";
import { gitSelectors } from "$lib/features/git/state/git-selectors.svelte";
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import { usageState } from "$lib/features/usage/state/usage-state.svelte";
import { selection } from "$lib/features/workspace/state/selection.svelte";
import { workspaceSelectors } from "$lib/features/workspace/state/workspace-selectors.svelte";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";
import { conversationState } from "./conversation-state.svelte";

function activeView() {
  const conversationId =
    selection.conversationId ?? conversationState.activeConversationTabId;
  if (!conversationId) return undefined;
  return conversationState.conversationViews[
    conversationViewKey(conversationId)
  ];
}

function activePendingConversation() {
  const active = workspaceState.activeCenterTab;
  if (active?.kind !== "pending-conversation") return undefined;
  return conversationState.pendingConversations[
    pendingConversationKey(active.id)
  ];
}

export const conversationSelectors = {
  get activeProject() {
    return workspaceSelectors.activeProject;
  },
  get activeConversation() {
    return workspaceSelectors.activeConversation;
  },
  get activeAgent() {
    return workspaceSelectors.activeAgent;
  },
  get activePendingConversation() {
    return activePendingConversation();
  },
  get pendingConversationActive() {
    return Boolean(activePendingConversation());
  },
  get activeUserQuestion() {
    const conversationId = selection.conversationId;
    const agentId = selection.agentId;
    return workspaceState.userQuestions.find((question) => {
      if (conversationId && question.conversationId === conversationId)
        return true;
      return Boolean(agentId && question.agentId === agentId);
    });
  },
  get activePlanReview() {
    const conversationId = selection.conversationId;
    const agentId = selection.agentId;
    return workspaceState.planReviews.find((review) => {
      if (conversationId && review.conversationId === conversationId)
        return true;
      return Boolean(agentId && review.agentId === agentId);
    });
  },
  get conversationActivityById() {
    return workspaceSelectors.conversationActivityById;
  },
  get conversationAgents() {
    return workspaceState.agents.filter(
      (agent) => agent.conversationId === selection.conversationId,
    );
  },
  get pendingApprovalCount() {
    return workspaceState.approvals.length;
  },
  get conversationActiveRun() {
    return activeView()?.activeRun;
  },
  get compacting() {
    return activeView()?.transient?.compaction?.state === "running";
  },
  get entries() {
    return activeView()?.entries ?? [];
  },
  get toolCalls() {
    return activeView()?.toolCalls ?? [];
  },
  get treeNodes() {
    return activeView()?.treeNodes ?? [];
  },
  get streamingText() {
    return activeRunStreamingText(activeView()?.activeRun);
  },
  get queuedPrompts() {
    return activeView()?.queuedPrompts ?? [];
  },
  get activeComposerText() {
    return (
      activePendingConversation()?.composerText ??
      activeView()?.composerText ??
      ""
    );
  },
  get gitSuggestions() {
    return gitSelectors.gitSuggestions;
  },
  get slashCompletions() {
    return conversationState.slashCompletions;
  },
  get selectedModelKey() {
    return conversationState.selectedModelKey;
  },
  get selectedThinkingLevel() {
    return conversationState.selectedThinkingLevel;
  },
  get selectedMode() {
    return conversationState.selectedMode;
  },
  get selectedPermissionLevel() {
    return conversationState.selectedPermissionLevel;
  },
  get selectedApprovalPolicy() {
    return conversationState.selectedApprovalPolicy;
  },
  get activeContextUsage() {
    return activeView()?.contextUsage;
  },
  get activeModelInfo() {
    const model = workspaceState.agents.find(
      (agent) => agent.id === selection.agentId,
    )?.model;
    if (!model) return undefined;
    return settingsState.models.find(
      (candidate) =>
        candidate.provider === model.provider &&
        candidate.modelId === model.modelId,
    );
  },
  get activeContextWindow(): number {
    const selectedModelInfo = settingsState.models.find(
      (model) => modelKey(model) === conversationState.selectedModelKey,
    );
    if (selectedModelInfo?.contextWindow)
      return selectedModelInfo.contextWindow;
    if (this.activeModelInfo?.contextWindow)
      return this.activeModelInfo.contextWindow;
    return activeView()?.contextUsage?.contextWindow ?? 0;
  },
  get activeConversationUsage() {
    const totals = {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
    };
    for (const entry of activeView()?.entries ?? []) {
      if (!entry.usage) continue;
      totals.input += entry.usage.input;
      totals.output += entry.usage.output;
      totals.cacheRead += entry.usage.cacheRead;
      totals.cacheWrite += entry.usage.cacheWrite;
      totals.cost += entry.usage.cost;
    }
    return totals;
  },
  get usableModels() {
    return scopedUsableModelOptions(
      settingsState.models,
      settingsState.authProviders,
      settingsState.settingsDraft?.scopedModels,
    );
  },
  get live() {
    return workspaceState.connection === "live";
  },
  get sending() {
    return (
      activePendingConversation()?.sending ?? activeView()?.sending ?? false
    );
  },
  get activeSubscriptionProvider() {
    return (
      workspaceState.agents.find((agent) => agent.id === selection.agentId)
        ?.model?.provider ??
      parseModelKey(conversationState.selectedModelKey)?.provider
    );
  },
  get activeSubscriptionUsage() {
    const provider = this.activeSubscriptionProvider;
    if (!provider) return undefined;
    return usageState.subscriptionUsage[provider];
  },
};
