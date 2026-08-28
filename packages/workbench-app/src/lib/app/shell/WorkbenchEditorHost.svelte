<script lang="ts">
import { EditorArea } from "$lib/presentation/shell";
import EditorTabStripHost from "$lib/app/shell/EditorTabStripHost.svelte";
import {
  centerViewLoaders,
  ConversationCenterHost,
  type CenterViewModule,
  type RegisteredCenterViewKind,
} from "$lib/app/composition/center-views";
import LazyViewPending from "$lib/app/shell/LazyViewPending.svelte";
import {
  centerTabKey,
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
} from "$lib/application/workspace";
import {
  toggleFileDisplayMode,
  toggleFileLineWrap,
} from "$lib/features/filesystem";
import type { CenterTabIdentity } from "$lib/application/workspace";
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
import CenterTabScrollLayer from "./CenterTabScrollLayer.svelte";
import { scheduleCenterTabScrollSnapshotPrune } from "./center-tab-scroll-restoration";

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
  scheduleCenterTabScrollSnapshotPrune(
    new Set(openCenterTabs.map((tab) => centerTabKey(tab))),
  );
});

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

// Registered views stay code-split and load only when first activated.
let loadedCenterViews = $state<
  Partial<Record<RegisteredCenterViewKind, CenterViewModule>>
>({});
$effect(() => {
  const kind = activeCenterTab?.kind;
  if (!kind || !(kind in centerViewLoaders)) return;
  const registeredKind = kind as RegisteredCenterViewKind;
  loadedCenterViews[registeredKind] ??= centerViewLoaders[registeredKind]();
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
    <EditorTabStripHost
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
      {#if activeCenterTab && !isConversationPaneTab(activeCenterTab)}
        {#key centerTabKey(activeCenterTab)}
          <CenterTabScrollLayer tabKey={centerTabKey(activeCenterTab)}>
            {#if activeCenterTab.kind === "task"}
              {#await loadedCenterViews.task}
                <LazyViewPending />
              {:then module}
                {@const Component = module?.default}
                {#if Component}<Component />{/if}
              {/await}
            {:else if activeCenterTab.kind === "file"}
              {#await loadedCenterViews.file}
                <LazyViewPending />
              {:then module}
                {@const Component = module?.default}
                {#if Component}<Component />{/if}
              {/await}
            {:else if activeCenterTab.kind === "mermaid"}
              {#await loadedCenterViews.mermaid}
                <LazyViewPending />
              {:then module}
                {@const Component = module?.default}
                {#if Component}<Component />{/if}
              {/await}
            {:else if activeCenterTab.kind === "pr"}
              {#await loadedCenterViews.pr}
                <LazyViewPending />
              {:then module}
                {@const Component = module?.default}
                {#if Component}<Component />{/if}
              {/await}
            {:else if activeCenterTab.kind === "diff"}
              {#await loadedCenterViews.diff}
                <LazyViewPending />
              {:then module}
                {@const Component = module?.default}
                {#if Component}<Component />{/if}
              {/await}
            {:else if activeCenterTab.kind === "settings"}
              {#await loadedCenterViews.settings}
                <LazyViewPending />
              {:then module}
                {@const Component = module?.default}
                {#if Component}<Component />{/if}
              {/await}
            {:else if activeCenterTab.kind === "logs"}
              {#await loadedCenterViews.logs}
                <LazyViewPending />
              {:then module}
                {@const Component = module?.default}
                {#if Component}<Component />{/if}
              {/await}
            {:else if activeCenterTab.kind === "discover"}
              {#await loadedCenterViews.discover}
                <LazyViewPending />
              {:then module}
                {@const Component = module?.default}
                {#if Component}<Component />{/if}
              {/await}
            {/if}
          </CenterTabScrollLayer>
        {/key}
      {/if}

      {#if renderedConversationPaneTabs.length > 0}
        {#each renderedConversationPaneTabs as tab (conversationPaneTabKey(tab))}
          {@const tabActive = conversationPaneTabsEqual(
            activeConversationPaneTab,
            tab,
          )}
          <CenterTabScrollLayer
            tabKey={conversationPaneTabKey(tab)}
            hidden={!tabActive}
          >
            <ConversationCenterHost {tab} active={tabActive} />
          </CenterTabScrollLayer>
        {/each}
      {:else if !activeCenterTab}
        <ConversationCenterHost active />
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
</style>
