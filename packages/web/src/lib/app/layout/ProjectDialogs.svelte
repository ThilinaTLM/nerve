<script lang="ts">
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";

  import { focusComposer, workbenchUiState } from "$lib/app/state/workbench-ui-state.svelte";
  import ConversationHistoryDialog from "$lib/features/conversations/components/ConversationHistoryDialog.svelte";
  import { conversationSelectors } from "$lib/features/conversations/state/conversation-selectors.svelte";
  import ProjectDirectoryPicker from "$lib/features/projects/components/ProjectDirectoryPicker.svelte";
  import { workspaceSelectors } from "$lib/features/workspace/state/workspace-selectors.svelte";
  import { compactActiveConversation, navigateToEntry } from "$lib/features/conversations/state/conversation-flow/run-control";
  import { setActiveComposerText } from "$lib/features/conversations/state/conversation-flow/prompt-send";
  import {
    createConversationForDirectory,
    deleteProjectAndRefresh,
  } from "$lib/features/workspace/state/workspace-actions.svelte";

  const status = $derived(workspaceSelectors.status);
  const projects = $derived(workspaceSelectors.projects);
  const conversations = $derived(workspaceSelectors.conversations);
  const activeConversation = $derived(conversationSelectors.activeConversation);
  const treeNodes = $derived(conversationSelectors.treeNodes);
  const toolCalls = $derived(conversationSelectors.toolCalls);

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
</script>

<ProjectDirectoryPicker
  bind:open={workspaceState.projectPickerOpen}
  {projects}
  {conversations}
  homeDir={status?.storage.home}
  onSelect={(path) => void createConversationForDirectory(path)}
  onForget={(id) => void deleteProjectAndRefresh(id)}
/>

<ConversationHistoryDialog
  bind:open={workbenchUiState.historyDialogOpen}
  {activeConversation}
  {treeNodes}
  {toolCalls}
  onNavigateToEntry={(entryId, summarize) => {
    void jumpToConversationEntry(entryId, summarize);
  }}
  onEditEntry={(entry) => {
    void editConversationEntry(entry);
  }}
  onCompact={() => void compactActiveConversation()}
/>
