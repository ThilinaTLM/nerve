<script lang="ts">
import {
  composerSignals,
  ConversationHistoryDialog,
  retainConversationStore,
  type ConversationStore,
} from "$lib/features/conversations";
import { selection } from "$lib/application/workspace/selection.svelte";
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
let store = $state<ConversationStore>();
$effect(() => {
  const id = selection.conversationId;
  if (!id || !composerSignals.historyDialogOpen) {
    store = undefined;
    return;
  }
  const retained = retainConversationStore(id);
  store = retained.store;
  void retained.ready.catch(() => undefined);
  return retained.release;
});
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

{#if store}
  <ConversationHistoryDialog
    bind:open={composerSignals.historyDialogOpen}
    {store}
  />
{/if}
