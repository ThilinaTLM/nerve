<script lang="ts">
  import Plus from "lucide-svelte/icons/plus";
  import X from "lucide-svelte/icons/x";
  import type { ConversationTabModel } from "../../stores/workbench/selectors.svelte";
  import { shortProjectLabel } from "../../utils/project-tree";
  import Button from "../ui/Button.svelte";

  type Props = {
    tabs?: ConversationTabModel[];
    activeSessionId?: string;
    homeDir?: string;
    onSelect?: (sessionId: string) => void;
    onClose?: (sessionId: string) => void;
    onNewConversation?: () => void;
  };

  let {
    tabs = [],
    activeSessionId,
    homeDir,
    onSelect,
    onClose,
    onNewConversation,
  }: Props = $props();

  function tabTitle(tab: ConversationTabModel): string {
    const project = tab.project?.dir
      ? shortProjectLabel(tab.project.dir, homeDir)
      : "Unknown project";
    return `${tab.session.title} · ${project} · ${tab.session.id}`;
  }

  function statusLabel(tab: ConversationTabModel): string | undefined {
    if (tab.error) return "Conversation has an error";
    if (tab.sending) return "Agent running";
    if (tab.hasDraft) return "Unsaved draft";
    return undefined;
  }
</script>

<nav class="conversation-tab-strip" aria-label="Open conversations">
  <div class="tab-scroller" role="tablist" aria-label="Conversation tabs">
    {#each tabs as tab}
      {@const active = tab.session.id === (activeSessionId ?? "") || tab.active}
      <div
        class="conversation-tab"
        class:active
        class:running={tab.sending}
        class:errored={Boolean(tab.error)}
      >
        <button
          type="button"
          class="tab-select"
          role="tab"
          aria-selected={active}
          title={tabTitle(tab)}
          onclick={() => onSelect?.(tab.session.id)}
        >
          <span class="tab-status" title={statusLabel(tab)} aria-hidden="true"></span>
          <span class="tab-title">{tab.session.title}</span>
          {#if tab.hasDraft}
            <span class="draft-dot" title="Draft" aria-label="Draft"></span>
          {/if}
        </button>
        <button
          type="button"
          class="tab-close"
          aria-label={`Close ${tab.session.title}`}
          title="Close conversation tab"
          onclick={() => onClose?.(tab.session.id)}
        >
          <X size={13} strokeWidth={2.2} />
        </button>
      </div>
    {/each}
  </div>

  <div class="tab-actions">
    <Button
      variant="icon"
      size="icon"
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
    min-height: var(--size-pane-header);
    grid-template-columns: minmax(0, 1fr) auto;
    border-bottom: 1px solid hsl(var(--border));
    background: hsl(var(--card));
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
    height: var(--size-pane-header);
    border-right: 1px solid hsl(var(--border) / 0.62);
    background: hsl(var(--card));
    color: hsl(var(--muted-foreground));
  }

  .conversation-tab::before {
    content: "";
    position: absolute;
    inset: 0 0 auto;
    height: 1px;
    background: transparent;
  }

  .conversation-tab:hover {
    background: hsl(var(--accent) / 0.6);
    color: hsl(var(--foreground));
  }

  .conversation-tab.active {
    background: hsl(var(--background));
    color: hsl(var(--foreground));
  }

  .conversation-tab.active::before {
    background: hsl(var(--primary));
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
    height: var(--size-pane-header);
    padding: 0 0.3rem 0 0.68rem;
    font-size: var(--text-xs);
    text-align: left;
  }

  .tab-select:focus-visible,
  .tab-close:focus-visible {
    outline: 1px solid hsl(var(--ring));
    outline-offset: -1px;
    z-index: 1;
  }

  .tab-status {
    flex: none;
    width: 0.42rem;
    height: 0.42rem;
    border-radius: 999px;
    background: hsl(var(--muted-foreground) / 0.5);
  }

  .conversation-tab.running .tab-status {
    background: hsl(var(--info));
    box-shadow: 0 0 0 0 hsl(var(--info) / 0.45);
    animation: tab-pulse 1.3s ease-out infinite;
  }

  .conversation-tab.errored .tab-status {
    background: hsl(var(--destructive));
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
    background: hsl(var(--primary));
  }

  .tab-close {
    display: inline-grid;
    width: 1.45rem;
    height: var(--size-pane-header);
    place-items: center;
    color: hsl(var(--muted-foreground));
    opacity: 0;
  }

  .conversation-tab:hover .tab-close,
  .conversation-tab:focus-within .tab-close,
  .conversation-tab.active .tab-close {
    opacity: 1;
  }

  .tab-close:hover,
  .tab-close:focus-visible {
    background: hsl(var(--accent));
    color: hsl(var(--foreground));
  }

  .tab-actions {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--size-pane-header);
    border-left: 1px solid hsl(var(--border) / 0.62);
  }

  @keyframes tab-pulse {
    70% {
      box-shadow: 0 0 0 5px hsl(var(--info) / 0);
    }
    100% {
      box-shadow: 0 0 0 0 hsl(var(--info) / 0);
    }
  }
</style>
