<script lang="ts">
  import ConversationPane from "$lib/features/conversations/components/ConversationPane.svelte";
  import {
    focusComposer,
    openConversationHistory,
    workbenchUiState,
  } from "$lib/app/state/workbench-ui-state.svelte";
  import { conversationSelectors } from "$lib/features/conversations/state/conversation-selectors.svelte";
  import { workspaceSelectors } from "$lib/features/workspace/state/workspace-selectors.svelte";
  import {
    abortActiveRun,
    acceptPendingPlanReview,
    acceptPendingPlanReviewInNewChat,
    answerUserQuestionById,
    completeFiles,
    continueFromFailure,
    denyApproval,
    dismissUserQuestionById,
    grantApproval,
    navigateToEntry,
    newConversationInProject,
    openFilePane,
    rejectPendingPlanReview,
    sendPrompt,
    sendPromptText,
    setActiveComposerText,
    setComposerMode,
    setComposerModel,
    setComposerPermission,
    setComposerThinkingLevel,
    workbenchState,
  } from "$lib/stores/workbench.svelte";

  const status = $derived(workspaceSelectors.status);
  const projects = $derived(workspaceSelectors.projects);
  const conversations = $derived(workspaceSelectors.conversations);
  const agents = $derived(workspaceSelectors.agents);
  const approvals = $derived(workspaceSelectors.approvals);
  const pendingUserQuestion = $derived(conversationSelectors.activeUserQuestion);
  const pendingPlanReview = $derived(conversationSelectors.activePlanReview);
  const transcript = $derived(conversationSelectors.transcript);
  const toolCalls = $derived(conversationSelectors.toolCalls);
  const treeNodes = $derived(conversationSelectors.treeNodes);
  const streamingText = $derived(conversationSelectors.streamingText);
  const conversationLiveState = $derived(
    conversationSelectors.conversationLiveState,
  );
  const queuedPrompts = $derived(conversationSelectors.queuedPrompts);
  const activeComposerText = $derived(conversationSelectors.activeComposerText);
  const gitSuggestions = $derived(conversationSelectors.gitSuggestions);
  const slashCompletions = $derived(conversationSelectors.slashCompletions);
  const selectedModelKey = $derived(conversationSelectors.selectedModelKey);
  const selectedThinkingLevel = $derived(
    conversationSelectors.selectedThinkingLevel,
  );
  const selectedMode = $derived(conversationSelectors.selectedMode);
  const selectedPermissionLevel = $derived(
    conversationSelectors.selectedPermissionLevel,
  );
  const activeProject = $derived(conversationSelectors.activeProject);
  const activeConversation = $derived(conversationSelectors.activeConversation);
  const activeAgent = $derived(conversationSelectors.activeAgent);
  const activePendingConversation = $derived(
    conversationSelectors.activePendingConversation,
  );
  const pendingConversationActive = $derived(
    conversationSelectors.pendingConversationActive,
  );
  const live = $derived(conversationSelectors.live);
  const sending = $derived(conversationSelectors.sending);
  const contextUsage = $derived(conversationSelectors.activeContextUsage);
  const contextWindow = $derived(conversationSelectors.activeContextWindow);
  const usableModels = $derived(conversationSelectors.usableModels);

  async function jumpToConversationEntry(
    entryId: string | undefined,
    summarize = false,
  ) {
    await navigateToEntry(entryId, summarize);
    focusComposer();
  }

  async function editConversationEntry(entry: {
    parentEntryId?: string;
    text: string;
  }) {
    await navigateToEntry(entry.parentEntryId);
    setActiveComposerText(entry.text);
    focusComposer();
  }

  function openProjectPicker() {
    workbenchState.projectPickerOpen = true;
  }

  function openToolFile(path: string, line?: number) {
    if (!activeProject) return;
    void openFilePane({ projectId: activeProject.id, path, line });
  }

  function applyGitSuggestion(suggestion: { prompt: string }) {
    const current = activeComposerText.trim();
    setActiveComposerText(
      current
        ? `${activeComposerText}\n\n${suggestion.prompt}`
        : suggestion.prompt,
    );
  }

  function sendGitSuggestion(suggestion: { prompt: string }) {
    void sendPromptText(suggestion.prompt, { clearComposer: false });
  }
</script>

<ConversationPane
  {activeProject}
  {activeConversation}
  {activeAgent}
  {activePendingConversation}
  {pendingConversationActive}
  {projects}
  {conversations}
  {agents}
  homeDir={status?.storage.home}
  {approvals}
  {pendingUserQuestion}
  {pendingPlanReview}
  {transcript}
  {toolCalls}
  {treeNodes}
  {streamingText}
  liveState={conversationLiveState}
  {queuedPrompts}
  {live}
  {sending}
  composerText={activeComposerText}
  {gitSuggestions}
  onSendGitSuggestion={sendGitSuggestion}
  onDraftGitSuggestion={applyGitSuggestion}
  models={usableModels}
  {selectedModelKey}
  thinkingLevel={selectedThinkingLevel}
  mode={selectedMode}
  permissionLevel={selectedPermissionLevel}
  {slashCompletions}
  {contextUsage}
  {contextWindow}
  composerFocusToken={workbenchUiState.composerFocusToken}
  composerEscapeToken={workbenchUiState.composerEscapeToken}
  micShortcutToken={workbenchUiState.micShortcutToken}
  fileCompletions={completeFiles}
  onComposerChange={setActiveComposerText}
  onSubmit={sendPrompt}
  onAnswerUserQuestion={answerUserQuestionById}
  onDismissUserQuestion={dismissUserQuestionById}
  onAbort={abortActiveRun}
  onOpenProject={openProjectPicker}
  onNewConversationInProject={newConversationInProject}
  onOpenFile={openToolFile}
  onModelChange={(value) => void setComposerModel(value)}
  onThinkingLevelChange={(value) => void setComposerThinkingLevel(value)}
  onModeChange={(value) => void setComposerMode(value)}
  onPermissionChange={(value) => void setComposerPermission(value)}
  onGrantApproval={(id) => void grantApproval(id)}
  onDenyApproval={(id) => void denyApproval(id)}
  onAcceptPlanReview={(id) => void acceptPendingPlanReview(id)}
  onAcceptPlanReviewInNewChat={(id) =>
    void acceptPendingPlanReviewInNewChat(id)}
  onRejectPlanReview={(id) => void rejectPendingPlanReview(id)}
  onContinueFromFailure={(id) => void continueFromFailure(id)}
  onNavigateToEntry={(entryId, summarize) => {
    void jumpToConversationEntry(entryId, summarize);
  }}
  onEditEntry={(entry) => {
    void editConversationEntry(entry);
  }}
  onOpenHistory={openConversationHistory}
/>
