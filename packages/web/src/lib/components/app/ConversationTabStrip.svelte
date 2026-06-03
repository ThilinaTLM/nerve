<script lang="ts">
  import Plus from "@lucide/svelte/icons/plus";
  import Terminal from "@lucide/svelte/icons/terminal";
  import X from "@lucide/svelte/icons/x";
  import type { CenterTabModel } from "../../stores/workbench/selectors.svelte";
  import { shortProjectLabel } from "../../utils/project-tree";
  import { shortenPath } from "../../utils/path";
  import { Button } from "$lib/components/ui/button";

  type TabIdentity = { kind: CenterTabModel["kind"]; id: string };

  type Props = {
    tabs?: CenterTabModel[];
    homeDir?: string;
    onSelect?: (tab: TabIdentity) => void;
    onClose?: (tab: TabIdentity) => void;
    onNewConversation?: () => void;
  };

  let {
    tabs = [],
    homeDir,
    onSelect,
    onClose,
    onNewConversation,
  }: Props = $props();

  function tabIdentity(tab: CenterTabModel): TabIdentity {
    return { kind: tab.kind, id: tab.id };
  }

  function tabLabel(tab: CenterTabModel): string {
    if (tab.kind === "process") return tab.process?.name ?? tab.process?.command ?? tab.id;
    return tab.session.title;
  }

  function tabTitle(tab: CenterTabModel): string {
    if (tab.kind === "process") {
      if (!tab.process) return `Missing process · ${tab.id}`;
      return `${tab.process.name ?? tab.process.command} · ${tab.process.status} · ${shortenPath(tab.process.cwd, homeDir)} · ${tab.process.id}`;
    }
    const project = tab.project?.dir
      ? shortProjectLabel(tab.project.dir, homeDir)
      : "Unknown project";
    return `${tab.session.title} · ${project} · ${tab.session.id}`;
  }

  function statusLabel(tab: CenterTabModel): string | undefined {
    if (tab.error) return tab.kind === "process" ? tab.error : "Conversation has an error";
    if (tab.sending) return tab.kind === "process" ? "Process active" : "Agent running";
    if (tab.kind === "conversation" && tab.hasDraft) return "Unsaved draft";
    if (tab.kind === "process") return tab.process?.status ?? "missing";
    return undefined;
  }
</script>

<nav class="conversation-tab-strip" aria-label="Open center tabs">
  <div class="tab-scroller" role="tablist" aria-label="Open conversations and process outputs">
    {#each tabs as tab (`${tab.kind}:${tab.id}`)}
      <div
        class="conversation-tab"
        class:active={tab.active}
        class:running={tab.sending}
        class:errored={Boolean(tab.error)}
        class:process-tab={tab.kind === "process"}
      >
        <button
          type="button"
          class="tab-select"
          role="tab"
          aria-selected={tab.active}
          title={tabTitle(tab)}
          onclick={() => onSelect?.(tabIdentity(tab))}
        >
          <span class="tab-status" title={statusLabel(tab)} aria-hidden="true"></span>
          {#if tab.kind === "process"}
            <span class="tab-kind-icon"><Terminal size={12} strokeWidth={2.2} aria-hidden="true" /></span>
          {/if}
          <span class="tab-title">{tabLabel(tab)}</span>
          {#if tab.kind === "conversation" && tab.hasDraft}
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
    {/each}
  </div>

  <div class="tab-actions">
    <Button
      variant="ghost"
      size="icon-sm"
      ariaLabel="New conversation"
      title="New conversation"
      onclick={onNewConversation}
    >
      <Plus size={13} strokeWidth={2.25} />
    </Button>
  </div>
</nav>

<style>
  .conversation-tab-strip {
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

  .conversation-tab {
    position: relative;
    display: inline-grid;
    flex: 0 1 12.5rem;
    grid-template-columns: minmax(0, 1fr) auto;
    min-width: 7.5rem;
    max-width: 15rem;
    height: 2rem;
    border-right: 1px solid color-mix(in oklab, var(--border) 62%, transparent);
    background: var(--card);
    color: var(--muted-foreground);
  }

  .conversation-tab.process-tab {
    flex-basis: 13.5rem;
  }

  .conversation-tab::before {
    content: "";
    position: absolute;
    inset: 0 0 auto;
    height: 1px;
    background: transparent;
  }

  .conversation-tab:hover {
    background: color-mix(in oklab, var(--accent) 60%, transparent);
    color: var(--foreground);
  }

  .conversation-tab.active {
    background: var(--background);
    color: var(--foreground);
  }

  .conversation-tab.active::before {
    background: var(--primary);
  }

  .tab-select,
  .tab-close {
    border: 0;
    border-radius: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .tab-select {
    display: inline-flex;
    align-items: center;
    gap: 0.42rem;
    min-width: 0;
    height: 2rem;
    padding: 0 0.3rem 0 0.68rem;
    font-size: 0.75rem;
    text-align: left;
  }

  .tab-select:focus-visible,
  .tab-close:focus-visible {
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

  .conversation-tab.running .tab-status {
    background: var(--info);
    box-shadow: 0 0 0 0 color-mix(in oklab, var(--info) 45%, transparent);
    animation: tab-pulse 1.3s ease-out infinite;
  }

  .conversation-tab.errored .tab-status {
    background: var(--destructive);
  }

  .tab-kind-icon {
    flex: none;
    color: color-mix(in oklab, var(--muted-foreground) 82%, transparent);
  }

  .conversation-tab.active .tab-kind-icon,
  .conversation-tab:hover .tab-kind-icon {
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
    height: 2rem;
    place-items: center;
    color: var(--muted-foreground);
    opacity: 0;
  }

  .conversation-tab:hover .tab-close,
  .conversation-tab:focus-within .tab-close,
  .conversation-tab.active .tab-close {
    opacity: 1;
  }

  .tab-close:hover,
  .tab-close:focus-visible {
    background: var(--accent);
    color: var(--foreground);
  }

  .tab-actions {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    border-left: 1px solid color-mix(in oklab, var(--border) 62%, transparent);
  }

  @keyframes tab-pulse {
    70% {
      box-shadow: 0 0 0 5px color-mix(in oklab, var(--info) 0%, transparent);
    }
    100% {
      box-shadow: 0 0 0 0 color-mix(in oklab, var(--info) 0%, transparent);
    }
  }
</style>
