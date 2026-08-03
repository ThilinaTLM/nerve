<script lang="ts">
import { EditorArea } from "$lib/presentation/shell";
import EditorTabStripContainer from "$lib/app/shell/EditorTabStripContainer.svelte";
import ConversationShell from "$lib/features/conversations/components/ConversationShell.svelte";
import FileShell from "$lib/features/filesystem/components/FileShell.svelte";
import DiffShell from "$lib/features/git/components/DiffShell.svelte";
import PrShell from "$lib/features/git/components/PrShell.svelte";
import LogsShell from "$lib/features/logs/components/LogsShell.svelte";
import TaskShell from "$lib/features/tasks/components/TaskShell.svelte";
import SettingsShell from "$lib/features/settings/components/SettingsShell.svelte";
import { AuthShell } from "$lib/features/auth";
import {
  centerTabsExcept,
  centerTabsToLeftOf,
  centerTabsToRightOf,
  closeCenterTab,
  closeCenterTabs,
  newConversation,
  reorderCenterTab,
  selectCenterTab,
  workspaceSelectors,
  workspaceState,
} from "$lib/features/workspace";
import {
  toggleFileDisplayMode,
  toggleFileLineWrap,
} from "$lib/features/filesystem";
import type { CenterTabIdentity } from "$lib/features/workspace";
import {
  conversationPaneTabKey,
  conversationPaneTabListsEqual,
  conversationPaneTabsEqual,
  isConversationPaneTab,
  renderableConversationPaneTabs,
  updateMountedConversationPaneTabs,
  type ConversationPaneTab,
} from "./keep-mounted-conversation-panes";
import { refreshCenterTab } from "./refresh-center-tab.svelte";

const status = $derived(workspaceSelectors.status);
const centerTabs = $derived(workspaceSelectors.centerTabs);
const activeCenterTab = $derived(workspaceSelectors.activeCenterTab);
const openCenterTabs = $derived(workspaceState.openCenterTabs);
const activeConversationPaneTab = $derived(
  isConversationPaneTab(activeCenterTab) ? activeCenterTab : undefined,
);

let mountedConversationPaneTabs = $state<ConversationPaneTab[]>([]);

const renderedConversationPaneTabs = $derived(
  renderableConversationPaneTabs(
    mountedConversationPaneTabs,
    activeConversationPaneTab,
  ),
);

$effect(() => {
  const nextMountedConversationPaneTabs = updateMountedConversationPaneTabs(
    mountedConversationPaneTabs,
    activeCenterTab,
    openCenterTabs,
  );
  if (
    !conversationPaneTabListsEqual(
      mountedConversationPaneTabs,
      nextMountedConversationPaneTabs,
    )
  ) {
    mountedConversationPaneTabs = nextMountedConversationPaneTabs;
  }
});

function closeOtherCenterTabs(tab: CenterTabIdentity) {
  void closeCenterTabs(centerTabsExcept(tab), tab);
}

function closeCenterTabsRight(tab: CenterTabIdentity) {
  void closeCenterTabs(centerTabsToRightOf(tab), tab);
}

function closeCenterTabsLeft(tab: CenterTabIdentity) {
  void closeCenterTabs(centerTabsToLeftOf(tab), tab);
}
</script>

<EditorArea contentVisible={true}>
  {#snippet tabStrip()}
    <EditorTabStripContainer
      tabs={centerTabs}
      homeDir={status?.storage.userHome}
      onSelect={(tab) => void selectCenterTab(tab)}
      onClose={(tab) => void closeCenterTab(tab)}
      onRefresh={refreshCenterTab}
      onCloseOther={closeOtherCenterTabs}
      onCloseRight={closeCenterTabsRight}
      onCloseLeft={closeCenterTabsLeft}
      onToggleFileDisplayMode={toggleFileDisplayMode}
      onToggleFileLineWrap={toggleFileLineWrap}
      onNew={newConversation}
      onReorder={reorderCenterTab}
    />
  {/snippet}
  {#snippet content()}
    <div class="center-workspace-content h-full">
      {#if activeCenterTab?.kind === "task"}
        <TaskShell />
      {:else if activeCenterTab?.kind === "file"}
        <FileShell />
      {:else if activeCenterTab?.kind === "pr"}
        <PrShell />
      {:else if activeCenterTab?.kind === "diff"}
        <DiffShell />
      {:else if activeCenterTab?.kind === "settings"}
        <SettingsShell />
      {:else if activeCenterTab?.kind === "auth"}
        <AuthShell />
      {:else if activeCenterTab?.kind === "logs"}
        <LogsShell />
      {/if}

      {#if renderedConversationPaneTabs.length > 0}
        {#each renderedConversationPaneTabs as tab (conversationPaneTabKey(tab))}
          {@const tabActive = conversationPaneTabsEqual(
            activeConversationPaneTab,
            tab,
          )}
          <div class="conversation-pane-layer" hidden={!tabActive}>
            <ConversationShell {tab} active={tabActive} />
          </div>
        {/each}
      {:else if !activeCenterTab}
        <ConversationShell active />
      {/if}
    </div>
  {/snippet}
</EditorArea>

<style>
.center-workspace-content {
  position: relative;
  display: grid;
  min-height: 0;
  min-width: 0;
}

.center-workspace-content > :global(*) {
  min-height: 0;
  min-width: 0;
}

.conversation-pane-layer {
  min-height: 0;
  min-width: 0;
}

.conversation-pane-layer[hidden] {
  display: none;
}
</style>
