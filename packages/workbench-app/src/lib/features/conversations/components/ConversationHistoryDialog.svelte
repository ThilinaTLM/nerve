<script lang="ts">
  import FoldVertical from "@lucide/svelte/icons/fold-vertical";
  import MoreHorizontal from "@lucide/svelte/icons/more-horizontal";
  import type {
    ConversationEntry,
    ConversationRecord,
    ConversationTreeNode,
    ToolCallTranscriptRecord,
  } from "$lib/api";
  import { buttonVariants } from "@nervekit/workbench-ui/components/ui/button";
  import ConfirmDialog from "@nervekit/workbench-ui/components/ui/confirm-dialog";
  import Dialog from "@nervekit/workbench-ui/components/ui/dialog-shell";
  import * as DropdownMenu from "@nervekit/workbench-ui/components/ui/dropdown-menu";
  import HistoryTab from "./HistoryTab.svelte";

  type Props = {
    open?: boolean;
    activeConversation?: ConversationRecord;
    treeNodes?: ConversationTreeNode[];
    toolCalls?: ToolCallTranscriptRecord[];
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

  let confirmCompactOpen = $state(false);

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
  title="Conversation history"
  description="Browse the branch tree, preview any point, then jump to or fork from it."
  class="conversation-history-dialog"
  onOpenChange={handleOpenChange}
>
  {#snippet headerActions()}
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        class={buttonVariants({ variant: "ghost", size: "icon-sm" })}
        aria-label="History actions"
        disabled={!activeConversation}
      >
        <MoreHorizontal class="size-4" strokeWidth={2} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" class="w-48">
        <DropdownMenu.Item disabled={!activeConversation} onSelect={() => (confirmCompactOpen = true)}>
          <FoldVertical />
          <span>Compact context</span>
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  {/snippet}

  <HistoryTab
    {activeConversation}
    {treeNodes}
    {toolCalls}
    onNavigateToEntry={navigateAndClose}
    onEditEntry={editAndClose}
  />
</Dialog>

<ConfirmDialog
  bind:open={confirmCompactOpen}
  title="Compact conversation"
  description="This summarizes earlier messages to reduce context size. The full history stays available in the branch tree."
  confirmLabel="Compact context"
  onConfirm={() => onCompact?.()}
/>

<style>
  :global(.conversation-history-dialog) {
    top: 4vh;
    /* Override the base dialog's vertical centering so the header stays on-screen. */
    transform: translateX(-50%);
    width: min(1100px, calc(100vw - 48px));
    height: min(760px, calc(100vh - 48px));
    max-height: calc(100vh - 8vh);
  }

  :global(.conversation-history-dialog .dialog-body) {
    overflow: hidden;
    background: var(--card);
  }
</style>
