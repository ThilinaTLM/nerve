<script lang="ts">
import {
  composerSignals,
  focusComposer,
  retainConversationStore,
  type ConversationStore,
} from "$lib/features/conversations";
import { ConversationHistoryDialog } from "$lib/features/conversations";
import { selection } from "$lib/application/workspace/selection.svelte";
import { conversationView } from "$lib/features/conversations";
import { conversationTranscript } from "$lib/features/conversations";
import type { ConversationEntry } from "$lib/presentation/view-models/conversation";
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
  void retained.ready
    .then(() => retained.store.loadHistoryTree())
    .catch(() => undefined);
  return retained.release;
});
const activeConversation = $derived(
  store?.snapshot ? conversationView(store.snapshot) : undefined,
);
const projection = $derived(
  store?.snapshot
    ? conversationTranscript({
        snapshot: store.snapshot,
        events: store.historyEvents ?? store.events,
        liveBlocks: store.liveBlocks,
        toolOutput: store.toolOutput,
      })
    : undefined,
);
const treeNodes = $derived(projection?.treeNodes ?? []);
const toolCalls = $derived(projection?.toolCalls ?? []);

async function branchFromConversationEntry(entryId: string | undefined) {
  if (!store) return;
  await store.selectHead(entryId ?? null);
  focusComposer();
}

async function editConversationEntry(entry: ConversationEntry) {
  if (!store) return;
  await store.selectHead(entry.parentEntryId ?? null);
  composerSignals.editEntry = entry;
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
  {toolCalls}
  onNavigateToEntry={(entryId) => {
    void branchFromConversationEntry(entryId);
  }}
  onEditEntry={(entry) => {
    void editConversationEntry(entry);
  }}
/>
