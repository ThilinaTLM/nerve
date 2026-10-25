<script lang="ts">
import ProfileUpdateNotice from "$lib/features/conversations/views/ProfileUpdateNotice.svelte";
import { projectAgentDefaults } from "$lib/application/agent-configuration/project-agent-defaults.svelte";
import type { EffectiveAgentView } from "@nervekit/contracts/agent-configuration";
import { CreationPreferencesState } from "$lib/features/settings/state/creation-preferences.svelte";
import { switchAgentProfile } from "$lib/features/conversations/adapters/core-agent-configuration.adapter";
import { compareSubagents } from "$lib/presentation/conversations/subagent-order";
import { untrack } from "svelte";
import GitBranchPlus from "@lucide/svelte/icons/git-branch-plus";
import GitCommitHorizontal from "@lucide/svelte/icons/git-commit-horizontal";
import GitPullRequest from "@lucide/svelte/icons/git-pull-request";
import Sparkles from "@lucide/svelte/icons/sparkles";
import { gitState } from "$lib/features/git/state/git-state.svelte";
import { gitContextFingerprint } from "$lib/features/git/state/git-context.svelte";
import {
  promptSuggestionsState,
  refreshPromptSuggestions,
} from "$lib/features/prompt-suggestions";
import PromptSuggestionTrustDialog from "$lib/features/prompt-suggestions/views/PromptSuggestionTrustDialog.svelte";
import type { ComposerSuggestion } from "$lib/features/conversations/views/composer-suggestion";
import { workbenchStartupState } from "$lib/application/startup/workbench-startup-state.svelte";
import { submitPendingConversation } from "$lib/app/composition/conversations/submit-pending-conversation";
import { captureSystemPromptPreview } from "$lib/app/composition/conversations/system-prompt-preview";
import { openSystemPromptPane } from "$lib/features/conversations/state/system-prompt-pane.svelte";
import { createId } from "@nervekit/contracts";
import type {
  ConversationConfig,
  InteractionResolution,
  EventTreeNode,
  UserInputAnswer,
} from "@nervekit/contracts/core";
import type { CompletionItem } from "@nervekit/contracts/completions";
import type {
  QueuedPromptRecord,
  ConversationEntry,
  PlanReviewResolveOptions,
} from "$lib/presentation/view-models/conversation";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";
import { workspaceSelectors } from "$lib/application/workspace/workspace-selectors.svelte";
import { pendingConversations } from "$lib/application/workspace/pending-conversations.svelte";
import {
  conversationDraftStore,
  type PromptDraftTarget,
} from "$lib/application/workspace/conversation-draft-store";
import {
  replaceOpenCenterTabs,
  selectCenterTab,
} from "$lib/application/workspace/center-tabs.svelte";
import type { ModelSelection } from "@nervekit/contracts/models";
import type { CenterTabIdentity } from "$lib/application/workspace";
import { newConversationInProject } from "$lib/application/workspace/workspace-actions.svelte";
import { clampThinkingLevelForModel } from "$lib/presentation/state/thinking-levels";
import {
  modelKey,
  parseModelKey,
  scopedUsableModelOptions,
} from "$lib/presentation/utils/model";
import { summarizeConversationUsage } from "$lib/presentation/usage/conversation-usage";
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import { openSettingsPane } from "$lib/application/settings";
import WorkbenchConversationAdapter from "$lib/app/composition/conversations/WorkbenchConversationHost.svelte";
import { conversationCatalog } from "$lib/features/conversations/state/conversation-catalog.svelte";
import {
  composerSignals,
  focusComposer,
  openConversationHistory,
} from "$lib/features/conversations/state/composer-signals.svelte";
import { retainConversationStore } from "$lib/features/conversations/state/open-conversation-stores";
import type { ConversationStore } from "$lib/features/conversations/state/core-conversation-store.svelte";
import {
  ConversationAgentUsageController,
  type AgentUsageState,
} from "$lib/features/conversations/state/conversation-agent-usage";
import { conversationTranscript } from "$lib/features/conversations/adapters/core-transcript.adapter";

import {
  conversationContext,
  projectView,
} from "$lib/features/conversations/adapters/core-context.adapter";
import {
  requestConversation,
  observeConversationChannel,
} from "$lib/application/startup/conversation-connection";
import ConversationActivityIsland from "$lib/features/conversations/agents/ConversationActivityIsland.svelte";
import { openAsyncBashTab } from "$lib/features/conversations";
import {
  pendingWork as derivePendingWork,
  agentProfileLabel,
} from "$lib/features/conversations/agents/agent-team";
import ConversationSettingsDialogs from "$lib/features/conversations/context/ConversationSettingsDialogs.svelte";
import ConversationContextActions from "$lib/features/conversations/context/ConversationContextActions.svelte";
import { ConversationCompactionState } from "$lib/features/conversations/context/conversation-compaction-state.svelte";
import { sessionFields } from "$lib/features/conversations/views/context-session-fields";
import { writeClipboardText } from "$lib/platform/clipboard/write-text";
import type { PendingWorkItem } from "$lib/presentation/transcript/activity/run-activity";
import type { AsyncBash } from "@nervekit/contracts/core";
import { openFilePane } from "$lib/features/filesystem/state/file-tabs.svelte";
import { openLaunchTab } from "$lib/features/launches";
import { composerReferenceSource } from "$lib/app/composition/conversations/composer-reference-completions";
import { notify } from "$lib/application/notifications/notify.svelte";
import { permissionRuleSetCatalog } from "$lib/application/permissions/permission-rule-set-catalog.svelte";
import { DEFAULT_AGENT_PROFILE } from "@nervekit/contracts/agent-profiles";
import { selectablePermissionRuleSets } from "$lib/domain/permissions/rule-set-options";
import {
  agentProfileCatalog,
  leadAgentProfiles,
} from "$lib/application/agent-profiles/agent-profile-catalog.svelte";
let { tab, active = true }: { tab?: CenterTabIdentity; active?: boolean } =
  $props();
const paneTab = $derived(tab ?? workspaceState.activeCenterTab);
const conversationId = $derived(
  paneTab?.kind === "conversation" ? paneTab.id : undefined,
);
const pendingId = $derived(
  paneTab?.kind === "pending-conversation" ? paneTab.id : undefined,
);
const activePendingConversation = $derived(
  pendingId ? pendingConversations.get(pendingId) : undefined,
);
const pendingConversationActive = $derived(!!activePendingConversation);
/** The tab's conversation (the lead of its sub-agents). */
let leadStore = $state<ConversationStore>();
/** A sub-agent shown in place of the lead's transcript, if any. */
let viewedChildId = $state<string>();
let childStore = $state<ConversationStore>();
let releaseChild: (() => void) | undefined;
let activityOpen = $state<"agents" | "commands" | null>(null);
/** Everything below acts on the conversation being viewed. */
const store = $derived(viewedChildId ? childStore : leadStore);
let tree = $state<EventTreeNode[]>([]);
const drafts = conversationDraftStore();
// The composer belongs to the lead, even while a read-only child is viewed.
const promptDraftTarget = $derived<PromptDraftTarget | undefined>(
  activePendingConversation
    ? {
        kind: "pending-conversation",
        id: activePendingConversation.id,
        projectId: activePendingConversation.projectId,
      }
    : conversationId
      ? { kind: "conversation", id: conversationId }
      : undefined,
);
let editText = $state("");
let stopping = $state(false);
let retryingResponse = $state(false);
let editTarget = $state<ConversationEntry>();
/** Shows a sub-agent in the main view; the lead id (or none) returns. */
function viewAgent(id: string | undefined) {
  releaseChild?.();
  releaseChild = undefined;
  childStore = undefined;
  viewedChildId = undefined;
  activityOpen = null;
  editTarget = undefined;
  if (!id || id === conversationId) return;
  const retained = retainConversationStore(id);
  releaseChild = retained.release;
  childStore = retained.store;
  viewedChildId = id;
  void retained.ready.catch((e) => notify.error(String(e)));
}
$effect(() => () => untrack(() => viewAgent(undefined)));
$effect(() => {
  if (viewedChildId && childStore?.deleted) viewAgent(undefined);
});
$effect(() => {
  const id = conversationId;
  leadStore = undefined;
  untrack(() => viewAgent(undefined));
  tree = [];
  editTarget = undefined;
  if (!id) return;
  const retained = retainConversationStore(id);
  leadStore = retained.store;
  void retained.ready.catch((e) => notify.error(String(e)));
  return retained.release;
});
const transcript = $derived(
  store?.snapshot
    ? conversationTranscript({
        snapshot: store.snapshot,
        events: store.events,
        liveBlocks: store.liveBlocks,
        toolOutput: store.toolOutput,
        tree,
      })
    : undefined,
);
const view = $derived(
  store?.snapshot && transcript
    ? {
        ...transcript,
        stopping:
          stopping || Boolean(transcript.transient?.compaction?.stopping),
        retryingResponse,
        responseRevision: store.responseRevision,
        transient: transcript.transient,
      }
    : undefined,
);
const context = $derived(
  store?.snapshot
    ? conversationContext(store.snapshot, store.events, settingsState.models)
    : undefined,
);
const activeConversation = $derived(context?.activeConversation);
const activeAgent = $derived(context?.activeAgent);
const activeProject = $derived.by(() => {
  const id =
    activePendingConversation?.projectId ??
    store?.snapshot?.conversation.projectId;
  const project = id
    ? workspaceState.projects.find((p) => p.id === id)
    : workspaceSelectors.activeProject;
  return project ? projectView(project) : undefined;
});
const activeApprovals = $derived(view?.approvals ?? []);
const pendingUserQuestions = $derived(view?.pendingUserQuestions ?? []);
const pendingPlanReviews = $derived(view?.pendingPlanReviews ?? []);
const profileCatalogProjectId = $derived(
  activePendingConversation?.projectId ??
    store?.snapshot?.conversation.projectId,
);
const resolvedProfiles = $derived(
  agentProfileCatalog.profiles(profileCatalogProjectId),
);
const effective = $derived(
  store?.effective?.status === "available" ? store.effective : undefined,
);
const creationPreferences = new CreationPreferencesState();
$effect(() => {
  if (activeProject?.id)
    void creationPreferences.load({
      scope: "project",
      projectId: activeProject.id,
    });
});
$effect(() => creationPreferences.observe());
const creationDefaults = $derived(
  creationPreferences.result?.status === "available"
    ? creationPreferences.result.effective
    : undefined,
);
let pendingResolution =
  $state<Extract<EffectiveAgentView, { status: "available" }>["resolution"]>();
// Non-reactive identity of the preview currently displayed. Preference edits
// refresh that target in place; a different draft/profile must not reuse it.
let pendingResolutionTarget: string | undefined;
const projectDefaultView = $derived(
  projectAgentDefaults.get(
    activePendingConversation?.projectId ?? activeProject?.id,
  ),
);
let pendingConfigurationRevision = $state(0);
$effect(() =>
  observeConversationChannel({
    recover: () => {
      pendingConfigurationRevision += 1;
      return Promise.resolve();
    },
    disconnected() {},
    event() {},
    notice: (notice) => {
      if (
        notice.type !== "agentConfiguration.changed" &&
        notice.type !== "conversationDefaults.changed"
      )
        return;
      const scope = notice.data.scope;
      if (
        scope.scope === "user" ||
        (scope.scope === "project" &&
          scope.projectId ===
            (activePendingConversation?.projectId ?? activeProject?.id))
      )
        pendingConfigurationRevision += 1;
    },
  }),
);
$effect(() => {
  void pendingConfigurationRevision;
  void creationDefaults;
  const pending = activePendingConversation;
  // Warm the backend's project projection before any draft exists. A blank
  // draft has the same target as these defaults, so opening it retains them.
  const projectId = pending?.projectId ?? activeProject?.id;
  if (!projectId) {
    pendingResolution = undefined;
    pendingResolutionTarget = undefined;
    return;
  }
  const name = pending?.explicitAgentProfile;
  const profile = resolvedProfiles.find((candidate) => candidate.name === name);
  if (name && !profile?.digest) {
    pendingResolution = undefined;
    pendingResolutionTarget = undefined;
    return;
  }
  const agentProfile = profile?.digest
    ? { name: profile.name, digest: profile.digest }
    : undefined;
  const overrides = $state.snapshot(pending?.overrides ?? {});
  if (!name && Object.keys(overrides).length === 0) {
    pendingResolution =
      projectDefaultView?.status === "available"
        ? projectDefaultView.resolution
        : undefined;
    pendingResolutionTarget = undefined;
    return;
  }
  const targetKey = JSON.stringify([
    projectId,
    agentProfile,
    creationDefaults?.defaultAgentProfile,
    name || Object.keys(overrides).length ? pending?.id : undefined,
  ]);
  if (pendingResolutionTarget !== targetKey) pendingResolution = undefined;
  pendingResolutionTarget = targetKey;
  let current = true;
  void requestConversation("agentConfiguration.resolveProject", {
    projectId,
    agentProfile,
    overrides,
  })
    .then((result) => {
      if (!current) return;
      pendingResolution =
        result.status === "available" ? result.resolution : undefined;
    })
    .catch(() => {
      if (current) pendingResolution = undefined;
    });
  return () => {
    current = false;
  };
});
const composerResolution = $derived(
  activePendingConversation
    ? !activePendingConversation.explicitAgentProfile &&
      !Object.keys(activePendingConversation.overrides ?? {}).length
      ? projectDefaultView?.status === "available"
        ? projectDefaultView.resolution
        : undefined
      : pendingResolution
    : effective?.resolution,
);
const selectedModelKey = $derived(
  composerResolution?.settings.model
    ? modelKey(composerResolution.settings.model)
    : "",
);
const selectedThinkingLevel = $derived(
  composerResolution?.settings.reasoningLevel ?? "off",
);
const selectedAgentProfile = $derived(
  activePendingConversation
    ? (activePendingConversation.explicitAgentProfile ??
        (projectDefaultView?.status === "available"
          ? projectDefaultView.appliedProfile.name
          : undefined) ??
        creationDefaults?.defaultAgentProfile ??
        DEFAULT_AGENT_PROFILE)
    : (effective?.appliedProfile?.name ?? DEFAULT_AGENT_PROFILE),
);
const selectedPermissionRuleSetId = $derived(
  composerResolution?.settings.permissionRuleSetId ?? "autonomous",
);
/** Profiles the selector offers; a viewed sub-agent shows only its own, read-only. */
const composerProfiles = $derived(
  viewedChildId
    ? [{ name: selectedAgentProfile, label: selectedAgentProfile }]
    : leadAgentProfiles(resolvedProfiles).map((profile) => ({
        name: profile.name,
        label: profile.label,
        description: profile.description,
      })),
);
const lockedFields = $derived({
  by: activePendingConversation
    ? selectedAgentProfile
    : effective?.appliedProfile?.name,
  model: composerResolution?.provenance["/model"]?.source === "requirement",
  thinking:
    composerResolution?.provenance["/reasoningLevel"]?.source === "requirement",
  permission:
    composerResolution?.provenance["/permissionRuleSetId"]?.source ===
    "requirement",
  compaction: Object.entries(composerResolution?.provenance ?? {}).some(
    ([pointer, value]) =>
      pointer.startsWith("/compaction/") && value.source === "requirement",
  ),
});
const activeCompactionLocked = $derived(Boolean(lockedFields.compaction));
const settingsDiffers = $derived({
  model:
    !viewedChildId &&
    !activePendingConversation &&
    store?.configuration?.status === "available" &&
    (store.configuration.overrides.model !== undefined ||
      store.configuration.overrides.reasoningLevel !== undefined),
  permission:
    !viewedChildId &&
    !activePendingConversation &&
    store?.configuration?.status === "available" &&
    store.configuration.overrides.permissionRuleSetId !== undefined,
});
$effect(() => {
  void agentProfileCatalog.ensure(profileCatalogProjectId);
});
const usableModels = $derived(
  scopedUsableModelOptions(
    settingsState.models,
    settingsState.authProviders,
    creationDefaults?.scopedModels,
  ),
);
const planReviewModelKey = $derived(selectedModelKey);
const planReviewThinkingLevel = $derived(selectedThinkingLevel);
/** Sub-agents run read-only or autonomous; nothing in between. */
const SUBAGENT_RULE_SETS = new Set(["read_only", "autonomous"]);
const permissionRuleSets = $derived(
  selectablePermissionRuleSets(
    permissionRuleSetCatalog.summaries(activeProject?.id),
  ).filter((rules) => !viewedChildId || SUBAGENT_RULE_SETS.has(rules.id)),
);
const permissionRuleSetsLoading = $derived(
  permissionRuleSetCatalog.loading(activeProject?.id),
);
const permissionRuleSetsError = $derived(
  permissionRuleSetCatalog.error(activeProject?.id),
);
let slashCompletions = $state<CompletionItem[]>([]);
$effect(() => {
  if (!activeProject) return;
  void requestConversation("completion.slash.list", {}).then((r) => {
    slashCompletions = r.items;
    conversationCatalog.slashCompletions = r.items;
  });
  void permissionRuleSetCatalog.refresh(activeProject.id);
});
const conversationUsage = $derived(
  context?.conversationUsage ?? summarizeConversationUsage([]),
);
let usageOpen = $state(false);
let agentUsageState = $state<AgentUsageState>({ loading: false });
const agentUsageController = new ConversationAgentUsageController({
  fetch: (conversationId) =>
    requestConversation("conversation.getUsage", { conversationId }),
  publish: (state) => {
    agentUsageState = state;
  },
});
$effect(() => {
  // All-time usage also drives the badge's cache warning, so fetch it while the
  // conversation is active; poll only while the details are open.
  agentUsageController.configure(
    store?.conversationId,
    active && !!store?.connected,
    usageOpen,
  );
});
// Each new response changes recorded usage.
$effect(() => {
  void conversationUsage.responseCount;
  untrack(() => agentUsageController.invalidate());
});
$effect(() => () => agentUsageController.dispose());
const contextWindow = $derived(
  context?.contextWindow ??
    settingsState.models.find((m) => modelKey(m) === selectedModelKey)
      ?.contextWindow ??
    0,
);
const activeComposerText = $derived(
  editTarget
    ? editText
    : promptDraftTarget
      ? drafts.getPrompt(promptDraftTarget)
      : "",
);
const builtinSuggestionIcons = {
  "commit-changes": GitCommitHorizontal,
  "commit-on-feature-branch": GitBranchPlus,
  "create-pull-request": GitPullRequest,
} as const;
const composerSuggestions = $derived.by<ComposerSuggestion[]>(() =>
  promptSuggestionsState.suggestions.map((suggestion) => ({
    id: `prompt:${suggestion.id}`,
    label: suggestion.label,
    prompt: suggestion.prompt,
    icon:
      suggestion.source.kind === "builtin"
        ? (builtinSuggestionIcons[
            suggestion.name as keyof typeof builtinSuggestionIcons
          ] ?? Sparkles)
        : Sparkles,
  })),
);
const promptSuggestionRefreshKey = $derived.by(() => {
  const ctx = gitState.gitContext;
  return ctx ? `${ctx.projectId}:${gitContextFingerprint(ctx)}` : "none";
});
$effect(() => {
  if (!workbenchStartupState.progressiveActive || !active || !activeProject?.id)
    return;
  void promptSuggestionRefreshKey;
  void store?.snapshot?.config;
  void store?.snapshot?.conversation.status;
  void store?.snapshot?.conversation.title;
  void refreshPromptSuggestions(activeProject.id, { conversationId });
});
function applySuggestion(suggestion: { prompt: string }) {
  const current = activeComposerText.trim();
  setPaneComposerText(
    current
      ? `${activeComposerText}\n\n${suggestion.prompt}`
      : suggestion.prompt,
  );
}
function sendSuggestion(suggestion: { prompt: string }) {
  void runActivePaneAction(() =>
    submitPrompt(suggestion.prompt, { clearComposer: false }),
  );
}
function setPaneComposerText(text: string) {
  if (editTarget) editText = text;
  else if (promptDraftTarget) drafts.setPrompt(promptDraftTarget, text);
}
async function runActivePaneAction(action: () => unknown | Promise<unknown>) {
  try {
    await action();
  } catch (e) {
    notify.error(e instanceof Error ? e.message : String(e));
  }
}
async function configure(
  patch: Partial<Omit<ConversationConfig, "conversationId">>,
) {
  const p = activePendingConversation;
  if (p) {
    Object.assign(p.config, patch);
    const { model, reasoningLevel, permissionRuleSetId } = patch;
    p.overrides = {
      ...p.overrides,
      ...(model ? { model } : {}),
      ...(reasoningLevel !== undefined ? { reasoningLevel } : {}),
      ...(permissionRuleSetId ? { permissionRuleSetId } : {}),
    };
    p.selectedModelKey = modelKey(p.config.model);
    p.thinkingLevel = p.config.reasoningLevel;
    p.agentProfile = p.config.agentProfile;
    p.permissionRuleSetId = p.config.permissionRuleSetId;
  } else await store?.configure(patch);
}
async function submitPrompt(
  text = activeComposerText,
  options: { clearComposer?: boolean } = {},
) {
  if (!text.trim() || viewedChildId) return;
  const pending = activePendingConversation;
  if (pending) {
    if (pending.sending) return;
    pending.sending = true;
    try {
      const snapshot = await submitPendingConversation(pending, text, {
        create: (input) =>
          requestConversation("conversation.create", {
            id: createId("conv"),
            ...input,
          }),
        getSnapshot: (conversationId) =>
          requestConversation("conversation.getSnapshot", { conversationId }),
        configure: (conversationId, patch) =>
          requestConversation("conversation.configure", {
            conversationId,
            patch,
          }),
        resolveProfile: async (projectId, name) => {
          const profile = (await agentProfileCatalog.ensure(projectId)).find(
            (p) => p.name === name,
          );
          if (!profile?.digest)
            throw new Error("Profile unavailable. Refresh and try again.");
          return { name, digest: profile.digest };
        },
        setAgentProfile: switchAgentProfile,
        saveOverrides: async (conversationId, changes) => {
          const scope = { scope: "conversation" as const, conversationId };
          const current = await requestConversation("agentConfiguration.get", {
            scope,
          });
          if (current.status !== "available")
            throw new Error("Configuration unavailable.");
          const result = await requestConversation("agentConfiguration.save", {
            scope,
            expectedRevision: current.source.revision,
            expectedDigest: current.source.digest,
            changes,
            resets: [],
          });
          if (result.status !== "saved")
            throw new Error(
              `Configuration ${result.status}. Refresh and try again.`,
            );
        },
        submit: (conversationId, prompt) =>
          requestConversation("input.submit", {
            conversationId,
            inputId: createId("input"),
            text: prompt,
            source: "user",
          }),
      });
      const pendingTarget: PromptDraftTarget = {
        kind: "pending-conversation",
        id: pending.id,
        projectId: pending.projectId,
      };
      if (options.clearComposer !== false)
        drafts.clearPromptIfUnchanged(pendingTarget, text);
      // Move any remaining draft to the created conversation before the tab is promoted.
      drafts.promotePendingPrompt(pending.id, snapshot.conversation.id);
      workspaceState.conversations = [
        ...workspaceState.conversations,
        {
          ...snapshot.conversation,
          childCount: 0,
          agentProfile: snapshot.config.agentProfile,
          model: snapshot.config.model,
          permissionRuleSetId: snapshot.config.permissionRuleSetId,
        },
      ];
      replaceOpenCenterTabs(
        workspaceState.openCenterTabs.map((t) =>
          t.kind === "pending-conversation" && t.id === pending.id
            ? { kind: "conversation", id: snapshot.conversation.id }
            : t,
        ),
      );
      pendingConversations.delete(pending.id);
      await selectCenterTab({
        kind: "conversation",
        id: snapshot.conversation.id,
      });
    } catch (e) {
      pending.error = String(e);
      throw e;
    } finally {
      pending.sending = false;
    }
    return;
  }
  const submittingStore = store;
  const submittingEdit = editTarget;
  const submittingTarget = promptDraftTarget;
  if (!submittingStore) return;
  if (submittingEdit)
    await submittingStore.selectHead(submittingEdit.parentEntryId ?? null);
  await submittingStore.submit(text);
  if (!submittingEdit && submittingTarget && options.clearComposer !== false)
    drafts.clearPromptIfUnchanged(submittingTarget, text);
  if (editTarget === submittingEdit && (!submittingEdit || editText === text))
    editTarget = undefined;
}
async function abortActiveRun() {
  stopping = true;
  try {
    await store?.control("stop");
  } finally {
    stopping = false;
  }
}
async function retryActiveResponse() {
  if (retryingResponse) return;
  retryingResponse = true;
  try {
    await store?.retryResponse();
  } finally {
    retryingResponse = false;
  }
}
async function compactActiveConversation() {
  await store?.control("compact");
}
async function cancelPendingCompaction() {
  await store?.cancelCompaction();
}
let openingSystemPrompt = false;
async function openSystemPrompt() {
  if (openingSystemPrompt) return;
  const target = captureSystemPromptPreview({
    pending: activePendingConversation,
    targetProfile: (() => {
      const name = activePendingConversation?.explicitAgentProfile;
      const profile = resolvedProfiles.find((p) => p.name === name);
      return profile?.digest
        ? { name: profile.name, digest: profile.digest }
        : undefined;
    })(),
    conversation: store?.snapshot?.conversation,
  });
  if (!target) return;
  openingSystemPrompt = true;
  try {
    const preview = await requestConversation(
      "conversation.previewSystemPrompt",
      target.params,
    );
    await openSystemPromptPane({
      projectId: target.projectId,
      sourceId: target.sourceId,
      text:
        preview.status === "available"
          ? preview.systemPrompt
          : "Configuration unavailable. Check scoped configuration diagnostics.",
    });
  } finally {
    openingSystemPrompt = false;
  }
}
const cancelActiveCompaction = abortActiveRun;
function openToolFile(path: string, line?: number) {
  if (activeProject)
    void openFilePane({ projectId: activeProject.id, path, line });
}
function openTaskFromNotice(id: string) {
  const command = store?.snapshot?.asyncBash.find(
    (candidate) => candidate.id === id,
  );
  if (command) void openAsyncBashTab(command, activeProject?.id);
  else void openLaunchTab(id);
}
/** The combined picker changes model and reasoning; locks keep either out. */
function setComposerModelSelection(next: {
  model?: ModelSelection;
  thinkingLevel?: ConversationConfig["reasoningLevel"];
}) {
  const model = next.model ?? parseModelKey(selectedModelKey);
  const reasoningLevel = clampThinkingLevelForModel(
    next.thinkingLevel ?? selectedThinkingLevel,
    settingsState.models.find(
      (candidate) => model && modelKey(candidate) === modelKey(model),
    ),
  );
  return configure({
    ...(model ? { model, reasoningLevel } : {}),
  });
}
function resetComposerModel() {
  return store?.configure({}, [
    ...(lockedFields.model ? [] : ["/overrides/model"]),
    ...(lockedFields.thinking ? [] : ["/overrides/reasoningLevel"]),
  ]);
}
function resetComposerPermission() {
  return store?.configure({}, ["/overrides/permissionRuleSetId"]);
}
async function setComposerAgentProfile(name: string) {
  const pending = activePendingConversation;
  if (pending) {
    // The exact catalog target is captured when creation is submitted.
    pending.config.agentProfile = name;
    pending.agentProfile = name;
    pending.explicitAgentProfile = name;
  } else await store?.setAgentProfile(name);
}
function setComposerPermissionRuleSet(value: string) {
  return configure({ permissionRuleSetId: value });
}
async function resolve(toolCallId: string, resolution: InteractionResolution) {
  const result = await store?.resolve(toolCallId, resolution);
  if (result?.status === "refresh_required") {
    const message =
      result.reason === "requirement_conflict"
        ? "Profile requirements conflict with the chosen model or reasoning. The plan remains open; repair the conflict and confirm again. No implementation request was submitted."
        : "Profile or configuration changed, or a previous approval was interrupted. The plan remains open; review the current configuration and refreshed requirements, then confirm again. No implementation request was submitted.";
    notify.warning("Plan review needs new confirmation", {
      description: message,
      duration: 10000,
    });
    throw new Error(message);
  }
  if (result?.status === "unavailable")
    throw new Error(
      "Configuration unavailable; reload it before confirming again. The review remains open and no implementation request was submitted.",
    );
}
function answerUserQuestion(
  toolCallId: string,
  answers: Record<string, UserInputAnswer>,
) {
  return resolve(toolCallId, { kind: "user_input", answers });
}
function dismissUserQuestion(toolCallId: string) {
  return resolve(toolCallId, {
    kind: "user_input",
    answers: {},
    dismissed: true,
  });
}
function grantApproval(
  toolCallId: string,
  scope?:
    | "single_call"
    | "always_conversation"
    | "always_project"
    | "always_user",
) {
  return resolve(toolCallId, {
    kind: "approval",
    decision: "approve",
    persistScope:
      scope === "always_conversation"
        ? "conversation"
        : scope === "always_project"
          ? "project"
          : scope === "always_user"
            ? "user"
            : undefined,
  });
}
function denyApproval(toolCallId: string) {
  return resolve(toolCallId, { kind: "approval", decision: "deny" });
}
async function acceptPendingPlanReview(
  toolCallId: string,
  options?: PlanReviewResolveOptions,
) {
  if (options?.compactBeforeImplementation)
    throw new Error(
      "Compacting a pending plan is not supported by the conversation core",
    );

  const interaction = store?.snapshot?.toolCalls.find(
    (item) => item.id === toolCallId,
  )?.interaction;
  if (interaction?.kind !== "plan_review")
    throw new Error("Plan review unavailable. Refresh and try again.");
  const request = interaction.request;
  await resolve(toolCallId, {
    kind: "plan_review",
    decision: "approve",
    feedback: options?.feedback,
    confirmation: {
      targetProfile: request.targetProfile,
      expectedRevision: request.expectedRevision,
      expectedDigest: request.expectedDigest,
      transitionId: createId("input"),
      choices: {
        ...(options?.implementationModel
          ? { model: options.implementationModel }
          : {}),
        ...(options?.implementationThinkingLevel !== undefined
          ? { reasoningLevel: options.implementationThinkingLevel }
          : {}),
      },
    },
  });
}

function rejectPendingPlanReview(toolCallId: string) {
  return resolve(toolCallId, { kind: "plan_review", decision: "reject" });
}
const continueFromFailure: (runId: string) => Promise<null> | undefined = () =>
  store?.control("continue");
function forcePushQueuedPrompts() {
  return store?.control("forcePush").then(() => undefined);
}
function discardQueuedPrompt(prompt: QueuedPromptRecord) {
  return store?.cancelInput(prompt.id).then(() => undefined);
}
async function moveQueuedPromptToComposer(prompt: QueuedPromptRecord) {
  const text = await store?.moveInputToComposer(prompt.id);
  if (text !== undefined) {
    setPaneComposerText(text);
    focusComposer();
  }
}
const jumpToConversationEntry: (
  id: string | undefined,
  summarize?: boolean,
) => Promise<void> = async (id) => {
  await store?.selectHead(id ?? null);
};
async function editConversationEntry(entry: ConversationEntry) {
  editTarget = entry;
  editText = entry.text;
  focusComposer();
}
$effect(() => {
  const entry = composerSignals.editEntry;
  if (
    active &&
    entry &&
    entry.conversationId === conversationId &&
    !viewedChildId
  ) {
    composerSignals.editEntry = undefined;
    void editConversationEntry(entry);
  }
});
const completionProjectId = $derived(activeProject?.id);
const completionConversationId = $derived(viewedChildId ?? conversationId);
// Construction is inert; only an active editor query acquires server data.
const completionSource = $derived(
  active && completionProjectId
    ? composerReferenceSource(completionProjectId, completionConversationId)
    : undefined,
);
/** The lead's context drives the agents tree in both lead and sub-agent views. */
const leadContext = $derived(
  !viewedChildId
    ? context
    : leadStore?.snapshot
      ? conversationContext(
          leadStore.snapshot,
          leadStore.events,
          settingsState.models,
        )
      : undefined,
);
const viewedConversationId = $derived(
  viewedChildId ?? leadStore?.snapshot?.conversation.id,
);
const backgroundCommands = $derived(store?.snapshot?.asyncBash ?? []);
const pendingWork = $derived(
  store?.snapshot
    ? derivePendingWork({
        children: store.snapshot.children,
        asyncBash: store.snapshot.asyncBash,
      })
    : [],
);
function openPendingWork(item: PendingWorkItem) {
  if (item.kind === "agent") viewAgent(item.id);
  else activityOpen = "commands";
}
function openCommand(command: AsyncBash) {
  void openAsyncBashTab(command, activeProject?.id);
}
const compactionSettings = new ConversationCompactionState();
$effect(() =>
  compactionSettings.follow(
    activeProject?.id,
    store?.snapshot?.conversation.id,
  ),
);
$effect(() => compactionSettings.observe());
let compactionDialogOpen = $state(false);
let instructionsDialogOpen = $state(false);
const instructions = $derived(store?.snapshot?.config.instructions ?? null);
const viewedProfile = $derived.by(() => {
  if (!viewedChildId) return undefined;
  const agent = leadContext?.conversationAgents.find(
    (candidate) => candidate.id === viewedChildId,
  );
  return agent ? agentProfileLabel(agent) : undefined;
});
const composerOverlay = $derived(
  viewedChildId
    ? {
        message: "Sub-agents take prompts only from their lead.",
        actionLabel: "Back to lead",
        onAction: () => viewAgent(undefined),
      }
    : undefined,
);
const session = $derived({
  fields: sessionFields({
    status: workspaceState.status,
    activeProject,
    activeConversation,
  }),
  onCopy: (text: string, label: string) => {
    void writeClipboardText(text).then(
      () => notify.success(`Copied ${label}`),
      () => notify.error("Could not copy to clipboard"),
    );
  },
});
const teamRunning = $derived(
  store?.snapshot?.children.some((c) => c.status === "running") ?? false,
);
</script>

<WorkbenchConversationAdapter
  {active}
  {pendingWork}
  onOpenPendingWork={openPendingWork}
  subagents={{
    list: () =>
      [...(leadStore?.snapshot?.children ?? [])]
        .sort(compareSubagents)
        .map((child) => ({
          id: child.id,
          name: child.title,
          status: child.status,
        })),
    open: (id) => viewAgent(id),
  }}
  editorOverlay={composerOverlay}
  {session}
  {activeProject}
  {activeConversation}
  {activeAgent}
  {activePendingConversation}
  {pendingConversationActive}
  conversationLoading={Boolean(
    conversationId && !store?.snapshot && !store?.error,
  )}
  homeDir={workspaceState.status?.storage.userHome}
  approvals={activeApprovals}
  {pendingUserQuestions}
  {pendingPlanReviews}
  entries={view?.entries ?? []}
  optimisticMessages={view?.optimisticMessages ?? []}
  toolCalls={view?.toolCalls ?? []}
  treeNodes={view?.treeNodes ?? []}
  activeRun={view?.activeRun}
  lastRunOutcome={view?.lastRunOutcome}
  transient={view?.transient}
  queuedPrompts={view?.queuedPrompts ?? []}
  recoveryIssues={view?.recoveryIssues ?? []}
  sending={activePendingConversation?.sending ?? view?.sending ?? false}
  {teamRunning}
  stopping={view?.stopping ?? false}
  retryingResponse={view?.retryingResponse ?? false}
  responseRevision={view?.responseRevision ?? 0}
  composerText={activeComposerText}
  composerSuggestions={viewedChildId ? [] : composerSuggestions}
  onSendSuggestion={sendSuggestion}
  onDraftSuggestion={applySuggestion}
  models={usableModels}
  {selectedModelKey}
  thinkingLevel={selectedThinkingLevel}
  planReviewModels={usableModels}
  {planReviewModelKey}
  {planReviewThinkingLevel}
  agentProfile={selectedAgentProfile}
  agentProfiles={composerProfiles}
  {lockedFields}
  {settingsDiffers}
  profileDisabled={Boolean(viewedChildId)}
  permissionRuleSetId={selectedPermissionRuleSetId}
  {permissionRuleSets}
  {permissionRuleSetsLoading}
  {permissionRuleSetsError}
  {slashCompletions}
  contextUsage={context?.contextUsage}
  {conversationUsage}
  agentUsage={agentUsageState.usage}
  agentUsageLoading={agentUsageState.loading}
  agentUsageError={agentUsageState.error}
  onUsageOpenChange={(open) => {
    usageOpen = open;
  }}
  onUsageRetry={() => agentUsageController.retry()}
  {contextWindow}
  composerFocusToken={composerSignals.focusToken}
  composerEscapeToken={composerSignals.escapeToken}
  micShortcutToken={composerSignals.micToken}
  {completionSource}
  onComposerChange={setPaneComposerText}
  onSubmit={() => {
    void runActivePaneAction(submitPrompt);
  }}
  onAnswerUserQuestion={answerUserQuestion}
  onDismissUserQuestion={dismissUserQuestion}
  onAbort={() => {
    void runActivePaneAction(
      view?.transient?.compaction?.state === "running"
        ? cancelActiveCompaction
        : abortActiveRun,
    );
  }}
  onCompact={() => {
    void runActivePaneAction(compactActiveConversation);
  }}
  onOpenSystemPrompt={activePendingConversation || activeConversation
    ? () => runActivePaneAction(openSystemPrompt)
    : undefined}
  onNewConversationInProject={newConversationInProject}
  onOpenFile={openToolFile}
  onOpenTask={openTaskFromNotice}
  onModelSelectionChange={(next) => {
    void runActivePaneAction(() => setComposerModelSelection(next));
  }}
  onResetModel={() => void runActivePaneAction(resetComposerModel)}
  onResetPermission={() => void runActivePaneAction(resetComposerPermission)}
  onAgentProfileChange={(value) => {
    void runActivePaneAction(() => setComposerAgentProfile(value));
  }}
  onPermissionRuleSetChange={(value) => {
    void runActivePaneAction(() => setComposerPermissionRuleSet(value));
  }}
  onRefreshPermissionRuleSets={() => {
    if (activeProject?.id) {
      void permissionRuleSetCatalog.refresh(activeProject.id);
    }
  }}
  onOpenPermissionSettings={() => void openSettingsPane("general")}
  onOpenCapabilitySettings={(page) => void openSettingsPane(page)}
  onGrantApproval={grantApproval}
  onDenyApproval={denyApproval}
  onAcceptPlanReview={acceptPendingPlanReview}
  onAcceptPlanReviewInNewChat={undefined}
  onRejectPlanReview={rejectPendingPlanReview}
  onRetryResponse={() => {
    void runActivePaneAction(retryActiveResponse);
  }}
  onCancelCompaction={() => {
    void runActivePaneAction(cancelPendingCompaction);
  }}
  onContinueFromFailure={(runId) => {
    void runActivePaneAction(() => continueFromFailure(runId));
  }}
  onForcePushQueuedPrompts={forcePushQueuedPrompts}
  onDiscardQueuedPrompt={discardQueuedPrompt}
  onMoveQueuedPromptToComposer={moveQueuedPromptToComposer}
  onNavigateToEntry={(entryId, summarize) => {
    void jumpToConversationEntry(entryId, summarize);
  }}
  onEditEntry={(entry) => {
    void editConversationEntry(entry);
  }}
  onOpenHistory={() => {
    void runActivePaneAction(openConversationHistory);
  }}
>
  {#snippet contextActions(closePopover)}
    <ConversationContextActions
      compaction={compactionSettings.compaction}
      compactionOverridden={compactionSettings.overridden}
      {instructions}
      profile={viewedProfile}
      disabled={!store?.snapshot || compactionSettings.saving}
      compactionLocked={activeCompactionLocked}
      onEditCompaction={() => {
        closePopover();
        compactionDialogOpen = true;
      }}
      onEditInstructions={() => {
        closePopover();
        instructionsDialogOpen = true;
      }}
    />
  {/snippet}
  {#snippet activity(showLatest, onJumpToBottom)}
    {#if effective?.appliedProfile && store && !viewedChildId}
      <ProfileUpdateNotice
        conversationId={store.conversationId}
        applied={effective.appliedProfile}
        onApplied={() => store!.refreshConfiguration()}
      />
    {/if}
    {#if viewedConversationId}
      <ConversationActivityIsland
        bind:open={activityOpen}
        {active}
        agents={leadContext?.conversationAgents ?? []}
        activities={leadContext?.agentActivities ?? {}}
        viewedId={viewedConversationId}
        commands={backgroundCommands}
        {showLatest}
        {onJumpToBottom}
        onSelectAgent={(id) => viewAgent(id)}
        onOpenCommand={openCommand}
      />
    {/if}
  {/snippet}
</WorkbenchConversationAdapter>

<ConversationSettingsDialogs
  bind:compactionOpen={compactionDialogOpen}
  bind:instructionsOpen={instructionsDialogOpen}
  compaction={compactionSettings.compaction}
  compactionOverridden={compactionSettings.overridden}
  {instructions}
  onSaveCompaction={(value) => compactionSettings.saveCompaction(value)}
  onResetCompaction={() => compactionSettings.saveCompaction(null)}
  onSaveInstructions={async (value) => {
    await store?.configure({ instructions: value });
  }}
/>

<PromptSuggestionTrustDialog projectId={activeProject?.id} {conversationId} />
