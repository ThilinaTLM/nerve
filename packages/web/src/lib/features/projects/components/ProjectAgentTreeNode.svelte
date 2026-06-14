<script lang="ts">
  import ContextMenu, {
    type ContextMenuItem,
  } from "$lib/components/ui/context-menu-list";
  import { StatusDot } from "$lib/components/ui/status-dot";
  import * as Tooltip from "$lib/components/ui/tooltip";
  import type { ConversationRow } from "$lib/utils/project-tree";
  import { shortAgentModel } from "$lib/utils/project-tree";
  import { agentActivityPulse, agentActivityTone } from "$lib/utils/status";
  import { dateTimeLabel } from "$lib/utils/time";

  type Props = {
    row: ConversationRow;
    isOpen?: boolean;
    isActive?: boolean;
    menuItems: ContextMenuItem[];
    onOpenConversation?: (conversationId: string) => void;
    titleMode?: "compact" | "expanded";
  };

  let {
    row,
    isOpen = false,
    isActive = false,
    menuItems,
    onOpenConversation,
    titleMode = "compact",
  }: Props = $props();

  const status = $derived(row.agent?.status ?? "idle");
  const mode = $derived(row.agent?.mode ?? row.conversation.mode);
  const permission = $derived(
    row.agent?.permissionLevel ?? row.conversation.permissionLevel,
  );
</script>

<ContextMenu items={menuItems} triggerClass="conversation-context-trigger">
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props: tip })}
        <button
          {...tip}
          type="button"
          class="conversation-row"
          data-active={isActive}
          data-title-mode={titleMode}
          title={row.conversation.title}
          onclick={() => onOpenConversation?.(row.conversation.id)}
        >
          <StatusDot
            class="conversation-status"
            tone={agentActivityTone(status)}
            pulse={agentActivityPulse(status)}
            variant={isOpen ? "solid" : "outline"}
            size="sm"
          />
          <span class="conversation-label">{row.conversation.title}</span>
        </button>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content side="right" sideOffset={6} class="nav-tooltip conversation-tooltip">
      <span class="tt-title">{row.conversation.title}</span>
      <span class="tt-row"><span class="tt-key">status</span>{status}</span>
      <span class="tt-row"><span class="tt-key">mode</span>{mode} · {permission}</span>
      <span class="tt-row"><span class="tt-key">model</span>{shortAgentModel(row.agent)}</span>
      <span class="tt-row"><span class="tt-key">updated</span>{dateTimeLabel(row.conversation.updatedAt)}</span>
      <span class="tt-id">{row.conversation.id}</span>
    </Tooltip.Content>
  </Tooltip.Root>
</ContextMenu>

<style>
  :global(.conversation-context-trigger) {
    display: block;
    width: 100%;
    min-width: 0;
  }

  .conversation-row {
    display: flex;
    width: 100%;
    min-width: 0;
    align-items: center;
    gap: 0.5rem;
    border-radius: var(--radius-sm);
    padding: 0.2rem 0.55rem;
    color: var(--muted-foreground);
    font-size: var(--text-sm);
    text-align: start;
    cursor: pointer;
    transition:
      color 120ms ease,
      background-color 120ms ease;
  }

  .conversation-row:hover {
    background: color-mix(in oklab, var(--muted) 60%, transparent);
    color: var(--foreground);
  }

  .conversation-row[data-active="true"] {
    background: var(--accent);
    color: var(--accent-foreground);
  }

  .conversation-row:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--ring) 60%, transparent);
  }

  :global(.conversation-status) {
    flex: none;
  }

  .conversation-row:hover :global(.conversation-status),
  .conversation-row[data-active="true"] :global(.conversation-status) {
    background-color: currentColor;
  }

  .conversation-label {
    display: block;
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    font-weight: 400;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .conversation-row[data-title-mode="expanded"] {
    min-height: 2.75rem;
    align-items: flex-start;
    padding-block: 0.35rem;
  }

  .conversation-row[data-title-mode="expanded"] :global(.conversation-status) {
    margin-top: 0.22rem;
  }

  .conversation-row[data-title-mode="expanded"] .conversation-label {
    display: -webkit-box;
    line-height: 1.3;
    text-overflow: clip;
    white-space: normal;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  :global(.nav-tooltip) {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.1rem;
    max-width: 22rem;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.35;
    overflow-wrap: anywhere;
  }

  :global(.conversation-tooltip) .tt-title {
    margin-bottom: 0.15rem;
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: 600;
  }

  :global(.conversation-tooltip) .tt-row {
    display: flex;
    gap: 0.4rem;
  }

  :global(.conversation-tooltip) .tt-key {
    min-width: 3.4rem;
    color: var(--muted-foreground);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  :global(.conversation-tooltip) .tt-id {
    margin-top: 0.2rem;
    color: var(--muted-foreground);
  }
</style>
