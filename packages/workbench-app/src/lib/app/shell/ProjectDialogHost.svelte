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
import { isLocalDesktopDaemon, isDesktopApp } from "$lib/platform/desktop";
import {
  openProjectDirectory,
  selectProject,
  workspaceSelectors,
  workspaceState,
} from "$lib/application/workspace";

const projects = $derived(workspaceSelectors.projects);

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
// The folders listed are the daemon's. The daemon reports no host name, so
// name it only when that is certain: the desktop shell's own daemon, or the
// host the web UI was served from.
let hostLabel = $state<string | undefined>();
$effect(() => {
  if (!workspaceState.projectPickerOpen) return;
  let current = true;
  const fromBrowser =
    typeof location === "undefined"
      ? undefined
      : LOOPBACK_HOSTS.has(location.hostname)
        ? "this computer"
        : location.hostname;
  if (!isDesktopApp()) {
    hostLabel = fromBrowser;
    return;
  }
  void isLocalDesktopDaemon().then((local) => {
    if (current) hostLabel = local ? "this computer" : undefined;
  });
  return () => {
    current = false;
  };
});
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
  initialPath={workspaceState.projectPickerPath}
  {hostLabel}
  onSelectProject={(projectId) => void selectProject(projectId)}
  onOpenDirectory={(path) => void openProjectDirectory(path)}
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
