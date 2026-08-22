<script lang="ts">
import {
  composerSignals,
  conversationSelectors,
  focusComposer,
  navigateToEntry,
  setActiveComposerText,
} from "$lib/features/conversations";
import { ConversationHistoryDialog } from "$lib/features/conversations";
import { ProjectDirectoryPicker } from "$lib/features/projects";
import {
  createConversationForDirectory,
  deleteProjectAndRefresh,
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

async function branchFromConversationEntry(entryId: string | undefined) {
  await navigateToEntry(entryId);
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
  switcherItems={projectItems}
  activeProjectKey={workspaceState.selectedProjectKey}
  homeDir={status?.storage.userHome}
  onSelectProject={(projectId) => void selectProject(projectId)}
  onOpenDirectory={(path) => void openProjectDirectory(path)}
  onNewChat={(path) => void createConversationForDirectory(path)}
  onForget={(id) => void deleteProjectAndRefresh(id)}
/>

<ConversationHistoryDialog
  bind:open={composerSignals.historyDialogOpen}
  {activeConversation}
  {treeNodes}
  {toolCalls}
  onNavigateToEntry={(entryId) => {
    void branchFromConversationEntry(entryId);
  }}
  onEditEntry={(entry) => {
    void editConversationEntry(entry);
  }}
/>
