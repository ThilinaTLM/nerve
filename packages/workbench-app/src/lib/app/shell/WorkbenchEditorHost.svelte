<script lang="ts">
import { EditorArea } from "$lib/presentation/shell";
import EditorTabStripHost from "$lib/app/shell/EditorTabStripHost.svelte";
import {
  centerViewLoaders,
  ConversationCenterHost,
  type CenterViewModule,
  type RegisteredCenterViewKind,
} from "$lib/app/composition/registries/center-view-registry";
import LazyViewPending from "$lib/app/shell/LazyViewPending.svelte";
import {
  centerTabKey,
  centerTabsExcept,
  centerTabsToLeftOf,
  centerTabsToRightOf,
  requestCloseCenterTab,
  requestCloseCenterTabs,
  resolveUnsavedFileClosePrompt,
  unsavedFileClosePrompt,
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
import * as Dialog from "@nervekit/ui-kit/components/ui/dialog";
import { Button } from "@nervekit/ui-kit/components/ui/button";
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
  void requestCloseCenterTabs(centerTabsExcept(tab), tab);
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
  void requestCloseCenterTabs(centerTabsToRightOf(tab), tab);
}

function closeCenterTabsLeft(tab: CenterTabIdentity) {
  void requestCloseCenterTabs(centerTabsToLeftOf(tab), tab);
}
</script>

<EditorArea contentVisible={true}>
  {#snippet tabStrip()}
    <EditorTabStripHost
      tabs={centerTabs}
      homeDir={status?.storage.userHome}
      onSelect={(tab) => void selectCenterTab(tab)}
      onClose={(tab) => void requestCloseCenterTab(tab)}
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

<Dialog.Root
  open={unsavedFileClosePrompt.open}
  onOpenChange={(open) => {
    if (!open) resolveUnsavedFileClosePrompt("cancel");
  }}
>
  <Dialog.Content showCloseButton={false}>
    <Dialog.Header>
      <Dialog.Title>
        {unsavedFileClosePrompt.files.length > 1
          ? "Save changes before closing files?"
          : "Save changes before closing?"}
      </Dialog.Title>
      <Dialog.Description>
        {unsavedFileClosePrompt.files.length > 1
          ? `${unsavedFileClosePrompt.files.length} files have unsaved changes.`
          : `“${unsavedFileClosePrompt.files[0]?.name ?? "This file"}” has unsaved changes.`}
      </Dialog.Description>
    </Dialog.Header>
    {#if unsavedFileClosePrompt.files.length > 1}
      <ul
        class="m-0 max-h-40 list-none overflow-y-auto rounded-md border border-border bg-well p-2 font-mono text-xs"
      >
        {#each unsavedFileClosePrompt.files as file (file.id)}
          <li class="truncate px-1 py-0.5" title={file.name}>{file.name}</li>
        {/each}
      </ul>
    {/if}
    <Dialog.Footer>
      <Button
        variant="outline"
        onclick={() => resolveUnsavedFileClosePrompt("cancel")}>Cancel</Button
      >
      <Button
        variant="destructive"
        onclick={() => resolveUnsavedFileClosePrompt("discard")}
        >{unsavedFileClosePrompt.files.length > 1
          ? "Discard all"
          : "Discard"}</Button
      >
      <Button onclick={() => resolveUnsavedFileClosePrompt("save")}
        >{unsavedFileClosePrompt.files.length > 1 ? "Save all" : "Save"}</Button
      >
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

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
