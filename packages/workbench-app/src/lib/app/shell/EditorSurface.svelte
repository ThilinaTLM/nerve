<script lang="ts">
import { EditorArea } from "$lib/presentation/shell";
import EditorTabStripContainer from "$lib/app/shell/EditorTabStripContainer.svelte";
import ConversationShell from "$lib/features/conversations/components/ConversationShell.svelte";
import LazyShellPending from "$lib/app/shell/LazyShellPending.svelte";
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

// On-demand center shells are code-split so their (potentially large) feature
// modules are not parsed during startup. The import fires when the tab is
// first activated; the chunk then loads in tens of milliseconds from localhost.
type CenterShellModule = Promise<{ default: import("svelte").Component }>;
const centerShells = {
  task: () => import("$lib/features/tasks/components/TaskShell.svelte"),
  file: () => import("$lib/features/filesystem/components/FileShell.svelte"),
  mermaid: () =>
    import("$lib/features/filesystem/components/MermaidShell.svelte"),
  pr: () => import("$lib/features/git/components/PrShell.svelte"),
  diff: () => import("$lib/features/git/components/DiffShell.svelte"),
  settings: () =>
    import("$lib/features/settings/components/SettingsShell.svelte"),
  logs: () => import("$lib/features/logs/components/LogsShell.svelte"),
} satisfies Record<string, () => CenterShellModule>;

let loadedShells = $state<Partial<Record<string, CenterShellModule>>>({});
$effect(() => {
  const kind = activeCenterTab?.kind;
  if (!kind || !(kind in centerShells) || loadedShells[kind]) return;
  loadedShells[kind] = centerShells[kind as keyof typeof centerShells]();
});

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
        {#await loadedShells.task}
          <LazyShellPending />
        {:then module}
          {@const Component = module?.default}
          {#if Component}<Component />{/if}
        {/await}
      {:else if activeCenterTab?.kind === "file"}
        {#await loadedShells.file}
          <LazyShellPending />
        {:then module}
          {@const Component = module?.default}
          {#if Component}<Component />{/if}
        {/await}
      {:else if activeCenterTab?.kind === "mermaid"}
        {#await loadedShells.mermaid}
          <LazyShellPending />
        {:then module}
          {@const Component = module?.default}
          {#if Component}<Component />{/if}
        {/await}
      {:else if activeCenterTab?.kind === "pr"}
        {#await loadedShells.pr}
          <LazyShellPending />
        {:then module}
          {@const Component = module?.default}
          {#if Component}<Component />{/if}
        {/await}
      {:else if activeCenterTab?.kind === "diff"}
        {#await loadedShells.diff}
          <LazyShellPending />
        {:then module}
          {@const Component = module?.default}
          {#if Component}<Component />{/if}
        {/await}
      {:else if activeCenterTab?.kind === "settings"}
        {#await loadedShells.settings}
          <LazyShellPending />
        {:then module}
          {@const Component = module?.default}
          {#if Component}<Component />{/if}
        {/await}
      {:else if activeCenterTab?.kind === "logs"}
        {#await loadedShells.logs}
          <LazyShellPending />
        {:then module}
          {@const Component = module?.default}
          {#if Component}<Component />{/if}
        {/await}
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
