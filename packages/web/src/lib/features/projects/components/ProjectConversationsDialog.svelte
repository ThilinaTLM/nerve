<script lang="ts">
  import Search from "@lucide/svelte/icons/search";
  import type { AgentRecord, ConversationRecord, ProjectRecord } from "$lib/api";
  import type { ContextMenuItem } from "@nervekit/shared-ui/components/ui/context-menu-list";
  import Dialog from "@nervekit/shared-ui/components/ui/dialog-shell";
  import { Input } from "@nervekit/shared-ui/components/ui/input";
  import type { ConversationActivityState } from "$lib/features/conversations/state/conversation-activity";
  import * as Tooltip from "@nervekit/shared-ui/components/ui/tooltip";
  import { VirtualScroller } from "@nervekit/shared-ui/components/ui/virtual-list";
  import { buildConversationRows } from "$lib/core/utils/project-tree";
  import ProjectAgentTreeNode from "./ProjectAgentTreeNode.svelte";

  type Props = {
    open?: boolean;
    projectLabel?: string;
    project?: ProjectRecord;
    projectIds?: string[];
    conversations?: ConversationRecord[];
    agents?: AgentRecord[];
    selectedConversationId?: string;
    openConversationTabIds?: Set<string>;
    conversationActivityById?: Record<string, ConversationActivityState>;
    onOpenConversation?: (conversationId: string) => void;
    buildMenu?: (conversation: ConversationRecord) => ContextMenuItem[];
    onOpenChange?: (open: boolean) => void;
  };

  let {
    open = $bindable(false),
    projectLabel = "",
    project: _project,
    projectIds = [],
    conversations = [],
    agents = [],
    selectedConversationId,
    openConversationTabIds,
    conversationActivityById = {},
    onOpenConversation,
    buildMenu,
    onOpenChange,
  }: Props = $props();

  let filter = $state("");
  let searchInputEl = $state<HTMLInputElement | null>(null);

  // Rows are sorted by latest user message by buildConversationRows.
  const rows = $derived(
    buildConversationRows({ conversations, agents, projectIds, filter }),
  );

  $effect(() => {
    if (open) {
      filter = "";
      queueMicrotask(() => searchInputEl?.focus());
    }
  });

  function handleOpenChange(next: boolean) {
    open = next;
    onOpenChange?.(next);
  }

  function openAndClose(conversationId: string) {
    onOpenConversation?.(conversationId);
    handleOpenChange(false);
  }
</script>

<Dialog
  bind:open
  title="Conversations"
  description={`${rows.length} in ${projectLabel}`}
  class="project-conversations-dialog"
  onOpenChange={handleOpenChange}
>
  <Tooltip.Provider delayDuration={300} disableHoverableContent>
    <div class="conversations-modal">
      <div class="search-box">
        <Search size={13} strokeWidth={2.25} aria-hidden="true" />
        <Input
          bind:ref={searchInputEl}
          bind:value={filter}
          size="sm"
          placeholder="Filter conversations"
          ariaLabel="Filter conversations"
        />
      </div>

      <div class="list-region">
        {#if rows.length === 0}
          <p class="empty">No conversations match.</p>
        {:else}
          <VirtualScroller
            items={rows}
            getKey={(row) => row.conversation.id}
            estimateSize={() => 32}
            viewportClass="conversations-virtual-list"
          >
            {#snippet row({ item })}
              <ProjectAgentTreeNode
                row={item}
                isOpen={openConversationTabIds?.has(item.conversation.id) ?? false}
                isActive={item.conversation.id === selectedConversationId}
                activity={conversationActivityById[item.conversation.id]}
                menuItems={buildMenu?.(item.conversation) ?? []}
                onOpenConversation={openAndClose}
              />
            {/snippet}
          </VirtualScroller>
        {/if}
      </div>
    </div>
  </Tooltip.Provider>
</Dialog>

<style>
  :global(.project-conversations-dialog) {
    width: min(880px, calc(100vw - 32px));
    height: min(640px, calc(100vh - 96px));
    max-height: calc(100vh - 96px);
  }

  :global(.project-conversations-dialog .dialog-body) {
    display: flex;
    overflow: hidden;
    background: var(--card);
  }

  .conversations-modal {
    display: grid;
    width: 100%;
    min-height: 0;
    grid-template-rows: auto minmax(0, 1fr);
  }

  .search-box {
    position: relative;
    display: grid;
    width: 100%;
    min-width: 0;
    align-items: center;
    padding: 0.55rem;
    border-bottom: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
  }

  .search-box :global(svg) {
    position: absolute;
    left: 0.95rem;
    z-index: 1;
    color: var(--muted-foreground);
    pointer-events: none;
  }

  .search-box :global([data-slot="input"]) {
    padding-left: 1.75rem;
  }

  .list-region {
    min-height: 0;
    padding: 0.45rem;
  }

  :global(.conversations-virtual-list) {
    height: 100%;
    padding: 0 0.1rem;
  }

  .empty {
    margin: 0.75rem 0.5rem;
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }
</style>
