<script lang="ts">
  import type {
    ConversationEntry,
    ConversationRecord,
    ConversationTreeNode,
    ToolCallRecord,
  } from "$lib/api";
  import Dialog from "$lib/components/ui/dialog-shell";
  import HistoryTab from "$lib/components/app/utility/HistoryTab.svelte";

  type Props = {
    open?: boolean;
    activeConversation?: ConversationRecord;
    treeNodes?: ConversationTreeNode[];
    toolCalls?: ToolCallRecord[];
    onNavigateToEntry?: (entryId: string | undefined, summarize?: boolean) => void;
    onEditEntry?: (entry: ConversationEntry) => void;
    onCompact?: () => void;
    onOpenChange?: (open: boolean) => void;
  };

  let {
    open = $bindable(false),
    activeConversation,
    treeNodes = [],
    toolCalls = [],
    onNavigateToEntry,
    onEditEntry,
    onCompact,
    onOpenChange,
  }: Props = $props();

  function handleOpenChange(next: boolean) {
    open = next;
    onOpenChange?.(next);
  }

  function navigateAndClose(entryId: string | undefined, summarize?: boolean) {
    onNavigateToEntry?.(entryId, summarize);
    open = false;
    onOpenChange?.(false);
  }

  function editAndClose(entry: ConversationEntry) {
    onEditEntry?.(entry);
    open = false;
    onOpenChange?.(false);
  }
</script>

<Dialog
  bind:open
  title="Conversation branches"
  description="Jump to any point; your next message creates or continues that branch."
  class="conversation-history-dialog"
  onOpenChange={handleOpenChange}
>
  <HistoryTab
    {activeConversation}
    {treeNodes}
    {toolCalls}
    onNavigateToEntry={navigateAndClose}
    onEditEntry={editAndClose}
    {onCompact}
  />
</Dialog>

<style>
  :global(.conversation-history-dialog) {
    top: 4vh;
    width: min(1100px, calc(100vw - 48px));
    height: min(760px, calc(100vh - 48px));
    max-height: calc(100vh - 48px);
  }

  :global(.conversation-history-dialog .dialog-body) {
    background: var(--card);
  }
</style>
