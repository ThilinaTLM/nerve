<script lang="ts">
import type {
  ConversationEntry,
  ConversationRecord,
  ConversationTreeNode,
  ToolCallTranscriptRecord,
} from "$lib/presentation/view-models/conversation";
import type { ConversationStore } from "../state/core-conversation-store.svelte";
import { conversationTranscript } from "../adapters/core-transcript.adapter";
import { conversationView } from "../adapters/core-context.adapter";
import { composerSignals } from "../state/composer-signals.svelte";
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";
import ConversationHistoryGraph from "./ConversationHistoryGraph.svelte";

type Props = {
  store?: ConversationStore;
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
  store,
  activeConversation: providedConversation,
  treeNodes: providedTree,
  toolCalls: providedTools,
  onNavigateToEntry,
  onEditEntry,
  onOpenChange,
}: Props = $props();

$effect(() => {
  if (open && store) void store.loadHistoryTree().catch(() => undefined);
});
const projection = $derived(
  store?.snapshot
    ? conversationTranscript({
        snapshot: store.snapshot,
        events: store.historyEvents ?? store.events,
        liveBlocks: store.liveBlocks,
        toolOutput: store.toolOutput,
      })
    : undefined,
);
const activeConversation = $derived(
  providedConversation ??
    (store?.snapshot ? conversationView(store.snapshot) : undefined),
);
const treeNodes = $derived(providedTree ?? projection?.treeNodes ?? []);
const toolCalls = $derived(providedTools ?? projection?.toolCalls ?? []);

function handleOpenChange(next: boolean) {
  open = next;
  onOpenChange?.(next);
}

function navigateAndClose(entryId: string | undefined) {
  if (onNavigateToEntry) onNavigateToEntry(entryId);
  else void store?.selectHead(entryId ?? null);
  open = false;
  onOpenChange?.(false);
}

function editAndClose(entry: ConversationEntry) {
  if (onEditEntry) onEditEntry(entry);
  else composerSignals.editEntry = entry;
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
