<script lang="ts">
import {
  editHistoryMessage,
  type HistoryNavigationTarget,
} from "$lib/features/conversations";
import {
  composerSignals,
  conversationSelectors,
  focusComposer,
  navigateToEntry,
  setActiveComposerText,
} from "$lib/features/conversations";
import { ConversationHistoryDialog } from "$lib/features/conversations";
import ProjectDirectoryPicker from "$lib/app/composition/dialogs/ProjectDirectoryPicker.svelte";
import {
  createConversationForDirectory,
  deleteProjectAndRefresh,
  maintenance,
  openProjectDirectory,
  selectProject,
  workspaceSelectors,
  workspaceState,
} from "$lib/application/workspace";

const status = $derived(workspaceSelectors.status);
const projects = $derived(workspaceSelectors.projects);
const projectItems = $derived(workspaceSelectors.projectSwitcherItems);
const activeConversation = $derived(conversationSelectors.activeConversation);
const treeNodes = $derived(conversationSelectors.treeNodes);
const toolCalls = $derived(conversationSelectors.toolCalls);

async function branchFromConversationEntry(entryId: string | null) {
  if (await navigateToEntry(entryId)) focusComposer();
}

async function editConversationEntry(
  entry: { text: string },
  target: HistoryNavigationTarget,
) {
  if (
    await editHistoryMessage(
      entry,
      target,
      navigateToEntry,
      setActiveComposerText,
    )
  )
    focusComposer();
}
</script>

<ProjectDirectoryPicker
  bind:open={workspaceState.projectPickerOpen}
  {projects}
  switcherItems={projectItems}
  activeProjectKey={workspaceState.selectedProjectKey}
  homeDir={status?.storage.userHome}
  initialMode={workspaceState.projectPickerMode}
  forgetDisabled={maintenance.active}
  onSelectProject={(projectId) => void selectProject(projectId)}
  onOpenDirectory={(path) => void openProjectDirectory(path)}
  onNewChat={(path) => void createConversationForDirectory(path)}
  onForget={(id) => void deleteProjectAndRefresh(id)}
/>

<ConversationHistoryDialog
  bind:open={composerSignals.historyDialogOpen}
  {activeConversation}
  {treeNodes}
  canNavigateToRoot={conversationSelectors.navigation?.canNavigateToRoot ??
    false}
  {toolCalls}
  onNavigateToEntry={(entryId) => {
    void branchFromConversationEntry(entryId);
  }}
  onEditEntry={(entry, target) => {
    void editConversationEntry(entry, target);
  }}
/>
