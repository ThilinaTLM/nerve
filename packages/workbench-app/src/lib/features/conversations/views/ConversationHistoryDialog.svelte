<script lang="ts">
import type {
  ConversationEntry,
  ConversationRecord,
  ConversationTreeNode,
  ToolCallTranscriptRecord,
} from "$lib/api";
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";
import ConversationHistoryGraph from "./ConversationHistoryGraph.svelte";

type Props = {
  open?: boolean;
  activeConversation?: ConversationRecord;
  treeNodes?: ConversationTreeNode[];
  toolCalls?: ToolCallTranscriptRecord[];
  onNavigateToEntry?: (entryId: string | undefined) => void;
  onEditEntry?: (entry: ConversationEntry) => void;
  onOpenChange?: (open: boolean) => void;
};

let {
  open = $bindable(false),
  activeConversation,
  treeNodes = [],
  toolCalls = [],
  onNavigateToEntry,
  onEditEntry,
  onOpenChange,
}: Props = $props();

function handleOpenChange(next: boolean) {
  open = next;
  onOpenChange?.(next);
}

function navigateAndClose(entryId: string | undefined) {
  onNavigateToEntry?.(entryId);
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
  flush
  bind:open
  size="viewport"
  title="Conversation history"
  description="Explore branches, inspect message and tool details, then branch from any point."
  onOpenChange={handleOpenChange}
>
  <div data-tour-id="conversation-history" class="h-full min-h-0">
    <ConversationHistoryGraph
      {activeConversation}
      {treeNodes}
      {toolCalls}
      onNavigateToEntry={navigateAndClose}
      onEditEntry={editAndClose}
    />
  </div>
</Dialog>
