<script lang="ts">
  import type { CenterTabIdentity, CenterTabModel } from "$lib/features/workspace";
  import {
    getShortcutAriaLabel,
    getShortcutLabel,
  } from "$lib/core/shortcuts/registry";
  import CenterTabItem from "./CenterTabItem.svelte";
  import NewTabButton from "./NewTabButton.svelte";
  import "./center-tab-strip.css";

  type Props = {
    tabs?: CenterTabModel[];
    homeDir?: string;
    onSelect?: (tab: CenterTabIdentity) => void;
    onClose?: (tab: CenterTabIdentity) => void;
    onRefresh?: (tab: CenterTabIdentity) => void;
    onCloseOther?: (tab: CenterTabIdentity) => void;
    onCloseRight?: (tab: CenterTabIdentity) => void;
    onCloseLeft?: (tab: CenterTabIdentity) => void;
    onToggleFileDisplayMode?: (id: string) => void;
    onToggleFileLineWrap?: (id: string) => void;
    onNewConversation?: () => void;
  };

  let {
    tabs = [],
    homeDir,
    onSelect,
    onClose,
    onRefresh,
    onCloseOther,
    onCloseRight,
    onCloseLeft,
    onToggleFileDisplayMode,
    onToggleFileLineWrap,
    onNewConversation,
  }: Props = $props();

  const newConversationShortcut = getShortcutLabel("conversation.new");
  const newConversationShortcutAria = getShortcutAriaLabel("conversation.new");
  const refreshShortcut = getShortcutLabel("pane.refresh");
  const closeShortcut = getShortcutLabel("pane.close");
  const closeOthersShortcut = getShortcutLabel("pane.closeOthers");
</script>

<nav class="center-tab-strip" aria-label="Open center tabs">
  <div class="tab-scroller" role="tablist" aria-label="Open center panes">
    {#each tabs as tab (`${tab.kind}:${tab.id}`)}
      <CenterTabItem
        {tab}
        {tabs}
        {homeDir}
        {refreshShortcut}
        {closeShortcut}
        {closeOthersShortcut}
        {onSelect}
        {onClose}
        {onRefresh}
        {onCloseOther}
        {onCloseRight}
        {onCloseLeft}
        {onToggleFileDisplayMode}
        {onToggleFileLineWrap}
      />
    {/each}
  </div>

  <div class="tab-actions">
    <NewTabButton
      shortcut={newConversationShortcut}
      shortcutAria={newConversationShortcutAria}
      {onNewConversation}
    />
  </div>
</nav>
