<script lang="ts">
  import BookOpenText from "@lucide/svelte/icons/book-open-text";
  import Code2 from "@lucide/svelte/icons/code-2";
  import Copy from "@lucide/svelte/icons/copy";
  import FileText from "@lucide/svelte/icons/file-text";
  import GitPullRequest from "@lucide/svelte/icons/git-pull-request";
  import Logs from "@lucide/svelte/icons/logs";
  import Plus from "@lucide/svelte/icons/plus";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Settings from "@lucide/svelte/icons/settings";
  import Terminal from "@lucide/svelte/icons/terminal";
  import X from "@lucide/svelte/icons/x";
  import { StatusDot } from "$lib/components/ui/status-dot";
  import { writeClipboardText } from "$lib/clipboard";
  import { notify } from "$lib/notifications/notify.svelte";
  import type { CenterTabModel } from "../../stores/workbench/selectors.svelte";
  import type { CenterTabIdentity } from "../../stores/workbench/state.svelte";
  import { shortenPath } from "../../utils/path";
  import { shortProjectLabel } from "../../utils/project-tree";
  import { Button } from "$lib/components/ui/button";
  import ContextMenu, { type ContextMenuItem } from "$lib/components/ui/context-menu-list";
  import { agentActivityPulse, agentActivityTone } from "../../utils/status";
  import {
    getShortcutAriaLabel,
    getShortcutLabel,
  } from "$lib/shortcuts/registry";

  type TabIdentity = CenterTabIdentity;

  type Props = {
    tabs?: CenterTabModel[];
    homeDir?: string;
    onSelect?: (tab: TabIdentity) => void;
    onClose?: (tab: TabIdentity) => void;
    onRefresh?: (tab: TabIdentity) => void;
    onCloseOther?: (tab: TabIdentity) => void;
    onCloseRight?: (tab: TabIdentity) => void;
    onCloseLeft?: (tab: TabIdentity) => void;
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

  function tabIdentity(tab: CenterTabModel): TabIdentity {
    if (tab.kind === "settings") return { kind: "settings", id: "settings" };
    if (tab.kind === "logs") return { kind: "logs", id: "logs" };
    return { kind: tab.kind, id: tab.id };
  }

  function tabLabel(tab: CenterTabModel): string {
    if (tab.kind === "process") return tab.process?.name ?? tab.process?.command ?? tab.id;
    if (tab.kind === "file") return tab.file?.name ?? tab.relativePath?.split("/").pop() ?? tab.path?.split("/").pop() ?? "File";
    if (tab.kind === "pr") return `#${tab.number}`;
    if (tab.kind === "settings") return "Settings";
    if (tab.kind === "logs") return "Nerve Logs";
    if (tab.kind === "pending-conversation") return tab.title;
    return tab.conversation.title;
  }

  function tabTitle(tab: CenterTabModel): string {
    if (tab.kind === "process") {
      if (!tab.process) return `Missing process · ${tab.id}`;
      return `${tab.process.name ?? tab.process.command} · ${tab.process.status} · ${shortenPath(tab.process.cwd, homeDir)} · ${tab.process.id}`;
    }
    if (tab.kind === "file") return tab.file?.path ?? tab.path ?? tab.id;
    if (tab.kind === "pr") return tab.title ? `#${tab.number} ${tab.title}` : `Pull request #${tab.number}`;
    if (tab.kind === "settings") return "Workbench settings";
    if (tab.kind === "logs") return "Nerve application logs";
    const project = tab.project?.dir
      ? shortProjectLabel(tab.project.dir, homeDir)
      : tab.kind === "pending-conversation"
        ? shortProjectLabel(tab.projectDir, homeDir)
        : "Unknown project";
    if (tab.kind === "pending-conversation")
      return `${tab.title} · ${project} · created on first send`;
    return `${tab.conversation.title} · ${project} · ${tab.conversation.id}`;
  }

  function statusLabel(tab: CenterTabModel): string | undefined {
    if (tab.error) return tab.error;
    if (tab.kind === "conversation" && tab.agent?.status === "awaiting_user") return "Needs user action";
    if (tab.sending) {
      if (tab.kind === "process") return "Process active";
      if (tab.kind === "file") return "Loading file";
      return "Agent running";
    }
    if ((tab.kind === "conversation" || tab.kind === "pending-conversation") && tab.hasDraft) return "Unsaved draft";
    if (tab.kind === "process") return tab.process?.status ?? "missing";
    if (tab.kind === "file" && tab.file?.truncated) return "Truncated";
    return undefined;
  }

  function agentStatus(tab: CenterTabModel): string | undefined {
    return tab.kind === "conversation" ? tab.agent?.status : undefined;
  }

  function tabIndex(tab: CenterTabModel): number {
    const identity = tabIdentity(tab);
    return tabs.findIndex((candidate) => {
      const candidateIdentity = tabIdentity(candidate);
      return candidateIdentity.kind === identity.kind && candidateIdentity.id === identity.id;
    });
  }

  function fileToggleLabel(tab: CenterTabModel): string {
    if (tab.kind !== "file") return "";
    return tab.displayMode === "rendered"
      ? "Show raw markdown"
      : "Show rendered markdown";
  }

  function handleFileDisplayToggle(event: MouseEvent, tab: CenterTabModel) {
    if (tab.kind !== "file") return;
    event.stopPropagation();
    onToggleFileDisplayMode?.(tab.id);
  }

  function fileWrapLabel(tab: CenterTabModel): string {
    if (tab.kind !== "file") return "";
    return tab.wrapLines ? "Disable line wrap" : "Wrap long lines";
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

  function tabMenu(tab: CenterTabModel): ContextMenuItem[] {
    const identity = tabIdentity(tab);
    const index = tabIndex(tab);
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

<nav class="center-tab-strip" aria-label="Open center tabs">
  <div class="tab-scroller" role="tablist" aria-label="Open center panes">
    {#each tabs as tab (`${tab.kind}:${tab.id}`)}
      <ContextMenu
        items={tabMenu(tab)}
        triggerClass={`center-tab-menu-trigger ${tab.kind === "process" || tab.kind === "file" ? "wide-tab" : ""}`}
      >
        <div
          class="center-tab"
          class:active={tab.active}
          class:running={tab.sending}
          class:errored={Boolean(tab.error)}
        >
          <div class="tab-leading">
            {#if tab.kind === "conversation" || tab.kind === "pending-conversation"}
              <StatusDot
                class="tab-agent-status"
                tone={agentActivityTone(agentStatus(tab), tab.sending)}
                pulse={agentActivityPulse(agentStatus(tab), tab.sending)}
                label={statusLabel(tab)}
              />
            {:else if tab.kind === "process"}
              <span class="tab-status" title={statusLabel(tab)} aria-hidden="true"></span>
            {:else if tab.kind === "file"}
              {#if tab.markdown}
                <button
                  type="button"
                  class="tab-file-toggle"
                  aria-label={fileToggleLabel(tab)}
                  title={fileToggleLabel(tab)}
                  disabled={!onToggleFileDisplayMode}
                  onclick={(event) => handleFileDisplayToggle(event, tab)}
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
          <button
            type="button"
            class="tab-select"
            role="tab"
            aria-selected={tab.active}
            title={tabTitle(tab)}
            onclick={() => onSelect?.(tabIdentity(tab))}
          >
            {#if tab.kind === "process"}
              <span class="tab-kind-icon"><Terminal size={12} strokeWidth={2.2} aria-hidden="true" /></span>
            {/if}
            <span class="tab-title">{tabLabel(tab)}</span>
            {#if (tab.kind === "conversation" || tab.kind === "pending-conversation") && tab.hasDraft}
              <span class="draft-dot" title="Draft" aria-label="Draft"></span>
            {/if}
          </button>
          <button
            type="button"
            class="tab-close"
            aria-label={`Close ${tabLabel(tab)}`}
            title="Close tab"
            onclick={() => onClose?.(tabIdentity(tab))}
          >
            <X size={13} strokeWidth={2.2} />
          </button>
        </div>
      </ContextMenu>
    {/each}
  </div>

  <div class="tab-actions">
    <Button
      variant="ghost"
      size="icon-sm"
      ariaLabel="New chat"
      aria-keyshortcuts={newConversationShortcutAria}
      title={newConversationShortcut ? `New chat (${newConversationShortcut})` : "New chat"}
      onclick={onNewConversation}
    >
      <Plus size={13} strokeWidth={2.25} />
    </Button>
  </div>
</nav>

<style>
  .center-tab-strip {
    display: grid;
    min-width: 0;
    min-height: 2rem;
    grid-template-columns: minmax(0, 1fr) auto;
    border-bottom: 1px solid var(--border);
    background: var(--card);
  }

  .tab-scroller {
    display: flex;
    min-width: 0;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: thin;
  }

  :global(.center-tab-menu-trigger) {
    flex: 0 1 12.5rem;
    min-width: 7.5rem;
    max-width: 15rem;
    height: 2rem;
  }

  :global(.center-tab-menu-trigger.wide-tab) {
    flex-basis: 13.5rem;
  }

  .center-tab {
    position: relative;
    display: inline-grid;
    width: 100%;
    height: 2rem;
    grid-template-columns: auto minmax(0, 1fr) auto;
    border-right: 1px solid color-mix(in oklab, var(--border) 62%, transparent);
    background: var(--card);
    color: var(--muted-foreground);
  }

  .center-tab::before {
    content: "";
    position: absolute;
    inset: 0 0 auto;
    height: 1px;
    background: transparent;
  }

  .center-tab:hover {
    background: color-mix(in oklab, var(--accent) 60%, transparent);
    color: var(--foreground);
  }

  .center-tab.active {
    background: var(--background);
    color: var(--foreground);
  }

  .center-tab.active::before {
    background: var(--primary);
  }

  .tab-select,
  .tab-close,
  .tab-file-toggle {
    border: 0;
    border-radius: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .tab-leading {
    display: inline-grid;
    width: 1.42rem;
    height: 2rem;
    place-items: center;
    padding-left: 0.38rem;
  }

  .tab-select {
    display: inline-flex;
    align-items: center;
    gap: 0.42rem;
    min-width: 0;
    height: 2rem;
    padding: 0 0.3rem;
    font-size: var(--text-xs);
    text-align: left;
  }

  .tab-select:focus-visible,
  .tab-close:focus-visible,
  .tab-file-toggle:focus-visible {
    outline: 1px solid var(--ring);
    outline-offset: -1px;
    z-index: 1;
  }

  .tab-status {
    flex: none;
    width: 0.42rem;
    height: 0.42rem;
    border-radius: 999px;
    background: color-mix(in oklab, var(--muted-foreground) 50%, transparent);
  }

  .tab-file-toggle {
    display: inline-grid;
    width: 1.15rem;
    height: 1.15rem;
    place-items: center;
    border-radius: var(--radius-sm);
    color: color-mix(in oklab, var(--muted-foreground) 82%, transparent);
  }

  .center-tab.active .tab-file-toggle,
  .center-tab:hover .tab-file-toggle {
    color: currentColor;
  }

  .tab-file-toggle:hover:not(:disabled) {
    background: var(--accent);
    color: var(--accent-foreground);
  }

  .tab-file-toggle:disabled {
    cursor: default;
    opacity: 0.7;
  }

  .center-tab.running .tab-status {
    background: var(--info);
    box-shadow: 0 0 0 0 color-mix(in oklab, var(--info) 45%, transparent);
    animation: tab-pulse 1.3s ease-out infinite;
  }

  .center-tab.errored .tab-status {
    background: var(--destructive);
  }

  .tab-kind-icon {
    flex: none;
    color: color-mix(in oklab, var(--muted-foreground) 82%, transparent);
  }

  .center-tab.active .tab-kind-icon,
  .center-tab:hover .tab-kind-icon {
    color: currentColor;
  }

  .tab-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .draft-dot {
    flex: none;
    width: 0.32rem;
    height: 0.32rem;
    border-radius: 999px;
    background: var(--primary);
  }

  .tab-close {
    display: inline-grid;
    width: 1.45rem;
    place-items: center;
    opacity: 0.62;
  }

  .tab-close:hover {
    background: color-mix(in oklab, var(--destructive) 12%, transparent);
    color: var(--destructive);
    opacity: 1;
  }

  .tab-actions {
    display: flex;
    align-items: center;
    border-left: 1px solid color-mix(in oklab, var(--border) 62%, transparent);
    padding: 0 0.28rem;
  }

  @keyframes tab-pulse {
    0% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--info) 45%, transparent); }
    100% { box-shadow: 0 0 0 0.36rem transparent; }
  }
</style>
