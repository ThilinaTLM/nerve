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
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import ChevronUp from "@lucide/svelte/icons/chevron-up";
import LocateFixed from "@lucide/svelte/icons/locate-fixed";
import Scan from "@lucide/svelte/icons/scan";
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import { SearchInput } from "@nervekit/ui-kit/components/composites/search-input";
import * as Empty from "@nervekit/ui-kit/components/ui/empty";
import { Kbd } from "@nervekit/ui-kit/components/ui/kbd";
import { untrack } from "svelte";
import ConversationHistoryGraph from "./ConversationHistoryGraph.svelte";
import HistoryDetailPane from "./HistoryDetailPane.svelte";
import {
  buildHistoryTree,
  findHistoryMatches,
  historyKeyTarget,
} from "./history-tree";

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

const toolCallsById = $derived(
  new Map(toolCalls.map((call) => [call.id, call])),
);
const tree = $derived(
  buildHistoryTree(treeNodes, activeConversation?.activeEntryId, toolCallsById),
);

// The selection follows the user's pick and falls back to the current head.
let pickedId = $state<string | undefined>();
let query = $state("");
let matchCursor = $state(-1);
let centerRequest = $state(0);
let fitRequest = $state(0);

const selectedId = $derived(
  pickedId && tree.nodes.has(pickedId) ? pickedId : tree.headId,
);
const selectedNode = $derived(tree.nodes.get(selectedId)!);
const matches = $derived(findHistoryMatches(tree, query));
const matchIds = $derived(new Set(matches));
const loaded = $derived(tree.nodes.size > 1);

const conversationId = $derived(activeConversation?.id);

// Every open starts on the current head with a clean search.
$effect(() => {
  void open;
  void conversationId;
  pickedId = undefined;
  query = "";
  matchCursor = -1;
  centerRequest = 0;
});
// Re-centre when the tree finishes loading or the head moves while open.
$effect(() => {
  void loaded;
  void tree.headId;
  untrack(() => {
    if (centerRequest > 0 && pickedId === undefined) centerRequest += 1;
  });
});

function select(id: string, center = false) {
  pickedId = id;
  if (center) centerRequest += 1;
}

function stepMatch(delta: number) {
  if (matches.length === 0) return;
  matchCursor = (matchCursor + delta + matches.length) % matches.length;
  select(matches[matchCursor]!, true);
}

const NAVIGATION_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "c",
  "C",
]);

function onKeyNavigate(event: KeyboardEvent) {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (!NAVIGATION_KEYS.has(event.key)) return;
  event.preventDefault();
  const target = historyKeyTarget(tree, selectedId, event.key);
  if (target) select(target, true);
}

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
  title="Branch history"
  description={activeConversation
    ? `${tree.entryCount.toLocaleString()} entries · ${tree.branchCount.toLocaleString()} ${tree.branchCount === 1 ? "branch" : "branches"}`
    : undefined}
  onOpenChange={handleOpenChange}
>
  {#snippet headerActions()}
    {#if activeConversation}
      <SearchInput
        bind:value={query}
        placeholder="Search entries"
        ariaLabel="Search entries"
        class="w-60"
        onValueChange={() => (matchCursor = -1)}
        onkeydown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          stepMatch(event.shiftKey ? -1 : 1);
        }}
      >
        {#snippet trailing()}
          {#if matches.length > 0}
            <span
              class="shrink-0 text-caption text-muted-foreground tabular-nums"
              >{Math.max(matchCursor + 1, 0)}/{matches.length}</span
            >
          {/if}
        {/snippet}
      </SearchInput>
      <IconAction
        icon={ChevronUp}
        label="Previous match"
        disabled={matches.length === 0}
        onclick={() => stepMatch(-1)}
      />
      <IconAction
        icon={ChevronDown}
        label="Next match"
        disabled={matches.length === 0}
        onclick={() => stepMatch(1)}
      />
      <IconAction
        icon={Scan}
        label="Fit tree"
        onclick={() => (fitRequest += 1)}
      />
      <IconAction
        icon={LocateFixed}
        label="Jump to current (C)"
        onclick={() => select(tree.headId, true)}
      />
    {/if}
  {/snippet}
  {#snippet footer()}
    <span
      class="flex flex-wrap items-center gap-1 text-caption text-muted-foreground"
    >
      <Kbd>↑</Kbd><Kbd>↓</Kbd> along a branch
      <Kbd>←</Kbd><Kbd>→</Kbd> sibling branch at a fork
      <Kbd>Home</Kbd> start <Kbd>C</Kbd> current
    </span>
  {/snippet}

  <div data-tour-id="conversation-history" class="h-full min-h-0">
    {#if activeConversation}
      <div
        class="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,40%)] min-[900px]:grid-cols-[minmax(0,1fr)_320px] min-[900px]:grid-rows-1"
      >
        <ConversationHistoryGraph
          {tree}
          {selectedId}
          {matchIds}
          {centerRequest}
          {fitRequest}
          onSelect={(id) => select(id)}
          {onKeyNavigate}
          onReady={() => (centerRequest += 1)}
        />
        <aside
          class="min-h-0 border-t border-border-subtle min-[900px]:border-t-0 min-[900px]:border-l"
          aria-label="Conversation entry details"
        >
          <HistoryDetailPane
            node={selectedNode}
            {toolCallsById}
            onNavigateToEntry={navigateAndClose}
            onEditEntry={editAndClose}
          />
        </aside>
      </div>
    {:else}
      <Empty.Root class="h-full">
        <Empty.Header>
          <Empty.Title class="text-ui">No conversation history</Empty.Title>
          <Empty.Description class="text-ui">
            Open a conversation to explore its branches.
          </Empty.Description>
        </Empty.Header>
      </Empty.Root>
    {/if}
  </div>
</Dialog>
