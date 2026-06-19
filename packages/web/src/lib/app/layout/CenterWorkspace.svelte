<script lang="ts">
  import CenterTabStrip from "$lib/app/layout/CenterTabStrip.svelte";
  import ConversationShell from "$lib/features/conversations/components/ConversationShell.svelte";
  import FileShell from "$lib/features/filesystem/components/FileShell.svelte";
  import PrShell from "$lib/features/git/components/PrShell.svelte";
  import LogsShell from "$lib/features/logs/components/LogsShell.svelte";
  import TaskShell from "$lib/features/tasks/components/TaskShell.svelte";
  import SettingsShell from "$lib/features/settings/components/SettingsShell.svelte";
  import { refreshConversationView } from "$lib/features/conversations";
  import {
    centerTabsExcept,
    centerTabsToLeftOf,
    centerTabsToRightOf,
    closeCenterTab,
    closeCenterTabs,
    newConversation,
    selectCenterTab,
    workspaceSelectors,
  } from "$lib/features/workspace";
  import {
    refreshFilePane,
    toggleFileDisplayMode,
    toggleFileLineWrap,
  } from "$lib/features/filesystem";
  import { refreshPrPane } from "$lib/features/git";
  import { loadSettingsPanel } from "$lib/features/settings";
  import type { CenterTabIdentity } from "$lib/features/workspace";

  const status = $derived(workspaceSelectors.status);
  const centerTabs = $derived(workspaceSelectors.centerTabs);
  const activeCenterTab = $derived(workspaceSelectors.activeCenterTab);

  function refreshCenterTab(tab: CenterTabIdentity) {
    if (tab.kind === "conversation") void refreshConversationView(tab.id);
    else if (tab.kind === "pending-conversation") void selectCenterTab(tab);
    else if (tab.kind === "task") void selectCenterTab(tab);
    else if (tab.kind === "file") void refreshFilePane(tab.id);
    else if (tab.kind === "pr") void refreshPrPane(tab.id);
    else void loadSettingsPanel();
  }

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

<CenterTabStrip
  tabs={centerTabs}
  homeDir={status?.storage.home}
  onSelect={(tab) => void selectCenterTab(tab)}
  onClose={(tab) => void closeCenterTab(tab)}
  onRefresh={refreshCenterTab}
  onCloseOther={closeOtherCenterTabs}
  onCloseRight={closeCenterTabsRight}
  onCloseLeft={closeCenterTabsLeft}
  onToggleFileDisplayMode={toggleFileDisplayMode}
  onToggleFileLineWrap={toggleFileLineWrap}
  onNewConversation={newConversation}
/>

{#if activeCenterTab?.kind === "task"}
  <TaskShell />
{:else if activeCenterTab?.kind === "file"}
  <FileShell />
{:else if activeCenterTab?.kind === "pr"}
  <PrShell />
{:else if activeCenterTab?.kind === "settings"}
  <SettingsShell />
{:else if activeCenterTab?.kind === "logs"}
  <LogsShell />
{:else}
  <ConversationShell />
{/if}
