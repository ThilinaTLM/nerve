import {
  modelKey,
  parseModelKey,
  scopedUsableModelOptions,
} from "$lib/presentation/utils/model";
import { activeRunStreamingText } from "$lib/presentation/state";
import { summarizeConversationUsage } from "$lib/presentation/usage/conversation-usage";
import type {
  AgentRecord,
  AuthProviderMetadata,
  ConversationRecord,
  ModelInfo,
  PlanReviewRecord,
  ProjectRecord,
  Settings,
  SubscriptionUsage,
  UserQuestionRecord,
} from "$lib/api";
import type { ConversationActivityState } from "$lib/domain/conversations/activity";
import {
  conversationViewKey,
  pendingConversationKey,
} from "$lib/domain/navigation/view-keys";
export interface ConversationSelectorWorkspaceReadModel {
  readonly selectedConversationId: string | undefined;
  readonly selectedAgentId: string | undefined;
  readonly activeCenterTab: { kind: string; id: string } | undefined;
  readonly activeProject: ProjectRecord | undefined;
  readonly activeConversation: ConversationRecord | undefined;
  readonly activeAgent: AgentRecord | undefined;
  readonly userQuestions: UserQuestionRecord[];
  readonly planReviews: PlanReviewRecord[];
  readonly conversationActivityById: Record<string, ConversationActivityState>;
  readonly agents: AgentRecord[];
  readonly connection: string;
  readonly models: ModelInfo[];
  readonly authProviders: AuthProviderMetadata[];
  readonly settingsDraft: Settings | undefined;
  readonly subscriptionUsage: Record<string, SubscriptionUsage>;
}

let workspaceReadModel: ConversationSelectorWorkspaceReadModel = {
  selectedConversationId: undefined,
  selectedAgentId: undefined,
  activeCenterTab: undefined,
  activeProject: undefined,
  activeConversation: undefined,
  activeAgent: undefined,
  userQuestions: [],
  planReviews: [],
  conversationActivityById: {},
  agents: [],
  connection: "connecting",
  models: [],
  authProviders: [],
  settingsDraft: undefined,
  subscriptionUsage: {},
};

export function registerConversationSelectorWorkspaceReadModel(
  readModel: ConversationSelectorWorkspaceReadModel,
): void {
  workspaceReadModel = readModel;
}
import { conversationState } from "./conversation-state.svelte";

function activeView() {
  const conversationId =
    workspaceReadModel.selectedConversationId ??
    conversationState.activeConversationTabId;
  if (!conversationId) return undefined;
  return conversationState.conversationViews[
    conversationViewKey(conversationId)
  ];
}

function activePendingConversation() {
  const active = workspaceReadModel.activeCenterTab;
  if (active?.kind !== "pending-conversation") return undefined;
  return conversationState.pendingConversations[
    pendingConversationKey(active.id)
  ];
}

const conversationSelectorsValue = {
  get activeProject() {
    return workspaceReadModel.activeProject;
  },
  get activeConversation() {
    return workspaceReadModel.activeConversation;
  },
  get activeAgent() {
    return workspaceReadModel.activeAgent;
  },
  get activePendingConversation() {
    return activePendingConversation();
  },
  get pendingConversationActive() {
    return Boolean(activePendingConversation());
  },
  get activeUserQuestion(): UserQuestionRecord | undefined {
    const conversationId = workspaceReadModel.selectedConversationId;
    const agentId = workspaceReadModel.selectedAgentId;
    return workspaceReadModel.userQuestions.find((question) => {
      if (conversationId && question.conversationId === conversationId)
        return true;
      return Boolean(agentId && question.agentId === agentId);
    });
  },
  get activePlanReview(): PlanReviewRecord | undefined {
    const conversationId = workspaceReadModel.selectedConversationId;
    const agentId = workspaceReadModel.selectedAgentId;
    return workspaceReadModel.planReviews.find((review) => {
      if (conversationId && review.conversationId === conversationId)
        return true;
      return Boolean(agentId && review.agentId === agentId);
    });
  },
  get conversationActivityById() {
    return workspaceReadModel.conversationActivityById;
  },
  get conversationAgents() {
    return workspaceReadModel.agents.filter(
      (agent) =>
        agent.conversationId === workspaceReadModel.selectedConversationId,
    );
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
  get selectedPermissionRuleSetId() {
    return conversationState.selectedPermissionRuleSetId;
  },
  get activeContextUsage() {
    return activeView()?.contextUsage;
  },
  get activeModelInfo() {
    const model = workspaceReadModel.agents.find(
      (agent) => agent.id === workspaceReadModel.selectedAgentId,
    )?.model;
    if (!model) return undefined;
    return workspaceReadModel.models.find(
      (candidate) =>
        candidate.provider === model.provider &&
        candidate.modelId === model.modelId,
    );
  },
  get activeContextWindow(): number {
    const selectedModelInfo = workspaceReadModel.models.find(
      (model) => modelKey(model) === conversationState.selectedModelKey,
    );
    if (selectedModelInfo?.contextWindow)
      return selectedModelInfo.contextWindow;
    if (this.activeModelInfo?.contextWindow)
      return this.activeModelInfo.contextWindow;
    return activeView()?.contextUsage?.contextWindow ?? 0;
  },
  get activeConversationUsage() {
    return summarizeConversationUsage(activeView()?.entries ?? []);
  },
  get usableModels() {
    return scopedUsableModelOptions(
      workspaceReadModel.models,
      workspaceReadModel.authProviders,
      workspaceReadModel.settingsDraft?.scopedModels,
    );
  },
  get live() {
    return workspaceReadModel.connection === "live";
  },
  get sending() {
    return (
      activePendingConversation()?.sending ?? activeView()?.sending ?? false
    );
  },
  get activeSubscriptionProvider() {
    return (
      workspaceReadModel.agents.find(
        (agent) => agent.id === workspaceReadModel.selectedAgentId,
      )?.model?.provider ??
      parseModelKey(conversationState.selectedModelKey)?.provider
    );
  },
  get activeSubscriptionUsage() {
    const provider = this.activeSubscriptionProvider;
    if (!provider) return undefined;
    return workspaceReadModel.subscriptionUsage[provider];
  },
};

// Svelte's generated declaration cannot name nested Zod output helpers here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const conversationSelectors: any = conversationSelectorsValue;
