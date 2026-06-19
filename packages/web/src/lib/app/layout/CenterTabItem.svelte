<script lang="ts">
  import BookOpenText from "@lucide/svelte/icons/book-open-text";
  import Code2 from "@lucide/svelte/icons/code-2";
  import Copy from "@lucide/svelte/icons/copy";
  import FileText from "@lucide/svelte/icons/file-text";
  import GitPullRequest from "@lucide/svelte/icons/git-pull-request";
  import Logs from "@lucide/svelte/icons/logs";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Settings from "@lucide/svelte/icons/settings";
  import Terminal from "@lucide/svelte/icons/terminal";
  import X from "@lucide/svelte/icons/x";
  import { StatusDot } from "$lib/components/ui/status-dot";
  import { writeClipboardText } from "$lib/core/clipboard";
  import ContextMenu, { type ContextMenuItem } from "$lib/components/ui/context-menu-list";
  import { notify } from "$lib/features/notifications/notify.svelte";
  import type { CenterTabIdentity, CenterTabModel } from "$lib/features/workspace";
  import {
    fileToggleLabel,
    fileWrapLabel,
    statusLabel,
    tabIdentity,
    tabIndex,
    tabLabel,
    tabTitle,
  } from "./center-tab-helpers";

  type Props = {
    tab: CenterTabModel;
    tabs: CenterTabModel[];
    homeDir?: string;
    refreshShortcut?: string;
    closeShortcut?: string;
    closeOthersShortcut?: string;
    onSelect?: (tab: CenterTabIdentity) => void;
    onClose?: (tab: CenterTabIdentity) => void;
    onRefresh?: (tab: CenterTabIdentity) => void;
    onCloseOther?: (tab: CenterTabIdentity) => void;
    onCloseRight?: (tab: CenterTabIdentity) => void;
    onCloseLeft?: (tab: CenterTabIdentity) => void;
    onToggleFileDisplayMode?: (id: string) => void;
    onToggleFileLineWrap?: (id: string) => void;
  };

  let {
    tab,
    tabs,
    homeDir,
    refreshShortcut,
    closeShortcut,
    closeOthersShortcut,
    onSelect,
    onClose,
    onRefresh,
    onCloseOther,
    onCloseRight,
    onCloseLeft,
    onToggleFileDisplayMode,
    onToggleFileLineWrap,
  }: Props = $props();

  function handleFileDisplayToggle(event: MouseEvent) {
    if (tab.kind !== "file") return;
    event.stopPropagation();
    onToggleFileDisplayMode?.(tab.id);
  }

  async function copyToClipboard(text: string | undefined, label: string) {
    if (!text) return;
    try {
      await writeClipboardText(text);
      notify.success(`Copied ${label}`);
    } catch {
      notify.error("Could not copy to clipboard");
    }
  }

  function tabMenu(): ContextMenuItem[] {
    const identity = tabIdentity(tab);
    const index = tabIndex(tabs, tab);
    const hasLeft = index > 0;
    const hasRight = index !== -1 && index < tabs.length - 1;
    const items: ContextMenuItem[] = [];

    if (tab.kind === "file") {
      const absolutePath = tab.file?.path ?? tab.path;
      const relativePath = tab.relativePath ?? tab.file?.relativePath;
      items.push(
        {
          label: "Copy Path",
          icon: Copy,
          disabled: !absolutePath,
          onSelect: () => void copyToClipboard(absolutePath, "path"),
        },
        {
          label: "Copy Relative Path",
          icon: Copy,
          disabled: !relativePath,
          onSelect: () => void copyToClipboard(relativePath, "relative path"),
        },
        { type: "separator" },
        {
          label: fileWrapLabel(tab),
          icon: Code2,
          disabled: !onToggleFileLineWrap,
          onSelect: () => onToggleFileLineWrap?.(tab.id),
        },
      );
    }

    items.push({
      label: "Refresh",
      icon: RefreshCw,
      shortcut: refreshShortcut,
      disabled: !onRefresh,
      onSelect: () => onRefresh?.(identity),
    });

    items.push(
      { type: "separator" },
      { label: "Close Pane", icon: X, shortcut: closeShortcut, onSelect: () => onClose?.(identity) },
      {
        label: "Close Other Panes",
        icon: X,
        shortcut: closeOthersShortcut,
        disabled: tabs.length <= 1 || !onCloseOther,
        onSelect: () => onCloseOther?.(identity),
      },
      {
        label: "Close Panes on Right",
        icon: X,
        disabled: !hasRight || !onCloseRight,
        onSelect: () => onCloseRight?.(identity),
      },
      {
        label: "Close Panes on Left",
        icon: X,
        disabled: !hasLeft || !onCloseLeft,
        onSelect: () => onCloseLeft?.(identity),
      },
    );

    return items;
  }
</script>

<ContextMenu
  items={tabMenu()}
  triggerClass={`center-tab-menu-trigger ${tab.kind === "task" || tab.kind === "file" ? "wide-tab" : ""}`}
>
  <div class="center-tab" class:active={tab.active} class:running={tab.sending} class:errored={Boolean(tab.error)}>
    <div class="tab-leading">
      {#if tab.kind === "conversation" || tab.kind === "pending-conversation"}
        <StatusDot class="tab-agent-status" tone={tab.activity.tone} pulse={tab.activity.pulse} label={statusLabel(tab)} />
      {:else if tab.kind === "task"}
        <span class="tab-status" title={statusLabel(tab)} aria-hidden="true"></span>
      {:else if tab.kind === "file"}
        {#if tab.markdown}
          <button
            type="button"
            class="tab-file-toggle"
            aria-label={fileToggleLabel(tab)}
            title={fileToggleLabel(tab)}
            disabled={!onToggleFileDisplayMode}
            onclick={handleFileDisplayToggle}
          >
            {#if tab.displayMode === "rendered"}
              <BookOpenText size={12} strokeWidth={2.2} aria-hidden="true" />
            {:else}
              <Code2 size={12} strokeWidth={2.2} aria-hidden="true" />
            {/if}
          </button>
        {:else}
          <span class="tab-kind-icon"><FileText size={12} strokeWidth={2.2} aria-hidden="true" /></span>
        {/if}
      {:else if tab.kind === "pr"}
        <span class="tab-kind-icon"><GitPullRequest size={12} strokeWidth={2.2} aria-hidden="true" /></span>
      {:else if tab.kind === "settings"}
        <span class="tab-kind-icon"><Settings size={12} strokeWidth={2.2} aria-hidden="true" /></span>
      {:else if tab.kind === "logs"}
        <span class="tab-kind-icon"><Logs size={12} strokeWidth={2.2} aria-hidden="true" /></span>
      {/if}
    </div>
    <button type="button" class="tab-select" role="tab" aria-selected={tab.active} title={tabTitle(tab, homeDir)} onclick={() => onSelect?.(tabIdentity(tab))}>
      {#if tab.kind === "task"}
        <span class="tab-kind-icon"><Terminal size={12} strokeWidth={2.2} aria-hidden="true" /></span>
      {/if}
      <span class="tab-title">{tabLabel(tab)}</span>
      {#if (tab.kind === "conversation" || tab.kind === "pending-conversation") && tab.hasDraft}
        <span class="draft-dot" title="Draft" aria-label="Draft"></span>
      {/if}
    </button>
    <button type="button" class="tab-close" aria-label={`Close ${tabLabel(tab)}`} title="Close tab" onclick={() => onClose?.(tabIdentity(tab))}>
      <X size={13} strokeWidth={2.2} />
    </button>
  </div>
</ContextMenu>
