<script lang="ts">
import type { AgentRecord, ConversationRecord, ProjectRecord } from "$lib/api";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/ui/context-menu-list";
import SearchInput from "@nervekit/ui-kit/components/ui/search-input";
import Dialog from "@nervekit/ui-kit/components/ui/dialog-shell";
import type { ConversationActivityState } from "$lib/features/conversations/state/conversation-activity";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import { VirtualScroller } from "@nervekit/ui-kit/components/ui/virtual-list";
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
  if (!open) return;
  filter = "";
  let focusFrame: number | undefined;
  const mountFrame = requestAnimationFrame(() => {
    focusFrame = requestAnimationFrame(() => searchInputEl?.focus());
  });
  return () => {
    cancelAnimationFrame(mountFrame);
    if (focusFrame !== undefined) cancelAnimationFrame(focusFrame);
  };
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
  flush
  bind:open
  title="Conversations"
  description={`${rows.length} in ${projectLabel}`}
  class="project-conversations-dialog"
  onOpenChange={handleOpenChange}
>
  <Tooltip.Provider delayDuration={300} disableHoverableContent>
    <div class="conversations-modal">
      <div class="search-box">
        <SearchInput
          bind:ref={searchInputEl}
          bind:value={filter}
          placeholder="Filter conversations"
          ariaLabel="Filter conversations"
        />
      </div>

      <div class="list-region">
        {#if rows.length === 0}
          <p
            class="mx-2 my-3 grid min-h-48 place-items-center gap-1 text-center font-mono text-xs text-muted-foreground"
          >
            No conversations match.
          </p>
        {:else}
          <VirtualScroller
            items={rows}
            getKey={(row) => row.conversation.id}
            estimateSize={() => 48}
            viewportClass="h-full px-0.5"
          >
            {#snippet row({ item })}
              <div class="py-0.5">
                <ProjectAgentTreeNode
                  row={item}
                  isOpen={openConversationTabIds?.has(item.conversation.id) ??
                    false}
                  isActive={item.conversation.id === selectedConversationId}
                  activity={conversationActivityById[item.conversation.id]}
                  menuItems={buildMenu?.(item.conversation) ?? []}
                  onOpenConversation={openAndClose}
                />
              </div>
            {/snippet}
          </VirtualScroller>
        {/if}
      </div>
    </div>
  </Tooltip.Provider>
</Dialog>

<style>
/* DialogShell portals its content, so the dialog geometry has to be declared
 * globally on the shell's own element (escape-hatch reason 5). The compound
 * selector keeps it ahead of `.dialog-content`'s defaults. */
:global(.dialog-content.project-conversations-dialog) {
  width: min(880px, calc(100vw - 32px));
  height: min(640px, calc(100vh - 96px));
  max-height: calc(100vh - 96px);
}

:global(.dialog-content.project-conversations-dialog .dialog-body) {
  display: flex;
  overflow: hidden;
}

.conversations-modal {
  display: grid;
  width: 100%;
  min-height: 0;
  grid-template-rows: auto minmax(0, 1fr);
}

.search-box {
  display: grid;
  width: 100%;
  min-width: 0;
  align-items: center;
  padding: 0.55rem;
  border-bottom: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
}

.list-region {
  min-height: 0;
  padding: 0.45rem;
}
</style>
