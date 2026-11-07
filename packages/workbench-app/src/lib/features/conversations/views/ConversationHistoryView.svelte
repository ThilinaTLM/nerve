<script lang="ts">
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import Eye from "@lucide/svelte/icons/eye";
import LocateFixed from "@lucide/svelte/icons/locate-fixed";
import MessagesSquare from "@lucide/svelte/icons/messages-square";
import Pencil from "@lucide/svelte/icons/pencil";
import Square from "@lucide/svelte/icons/square";
import Undo2 from "@lucide/svelte/icons/undo-2";
import X from "@lucide/svelte/icons/x";
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import { SearchInput } from "@nervekit/ui-kit/components/composites/search-input";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Kbd } from "@nervekit/ui-kit/components/ui/kbd";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import {
  dateTimeLabel,
  relativeTimeLabel,
} from "@nervekit/ui-kit/display/time";
import { tick } from "svelte";
import { SvelteSet } from "svelte/reactivity";
import type {
  ConversationEntry,
  ConversationTreeNode,
  ToolCallTranscriptRecord,
} from "$lib/presentation/view-models/conversation";
import { isMobileSurface } from "$lib/presentation/shell/mobile/mobile-surface";
import { HISTORY_ICONS } from "./history-icons";
import {
  buildHistoryItems,
  defaultFoldedBranches,
  historySpanLabel,
  itemsAfterOnCurrentPath,
  layoutHistoryRows,
  matchHistoryItems,
  type HistoryItem,
  type HistoryMode,
  type HistoryRow,
} from "./history-rows";
import { buildHistoryTree, HISTORY_ROOT_ID } from "./history-tree";

type Props = {
  /** Every stored entry of the conversation, all branches included. */
  treeNodes: ConversationTreeNode[];
  toolCalls?: ToolCallTranscriptRecord[];
  /** The current head. */
  activeEntryId?: string;
  /** The full tree is still loading. */
  loading?: boolean;
  /** Browse only: no rewind or edit (sub-agent history). */
  readOnly?: boolean;
  /** Running work blocks rewind and edit until it stops. */
  rewindLocked?: boolean;
  /** Move the head; `undefined` rewinds to the start. */
  onRewind: (entryId: string | undefined) => void;
  onEdit: (entry: ConversationEntry) => void;
  /** Return to the transcript at an entry on the current path. */
  onReveal: (entryId: string) => void;
  onClose: () => void;
};

let {
  treeNodes,
  toolCalls = [],
  activeEntryId,
  loading = false,
  readOnly = false,
  rewindLocked = false,
  onRewind,
  onEdit,
  onReveal,
  onClose,
}: Props = $props();

const mobile = isMobileSurface();
const LANE = 14;
const DOT_Y = 15;
const laneX = (lane: number) => 9 + lane * LANE;

const toolCallsById = $derived(
  new Map(toolCalls.map((call) => [call.id, call])),
);
const tree = $derived(
  buildHistoryTree(treeNodes, activeEntryId, toolCallsById),
);

let mode = $state<HistoryMode>("messages");
let query = $state("");
let pickedId = $state<string>();
const expanded = new SvelteSet<string>();

const model = $derived(buildHistoryItems(tree, mode));
const matches = $derived(matchHistoryItems(model, query));
const matchOrder = $derived(model.order.filter((id) => matches.has(id)));
const selectedId = $derived(
  pickedId && model.items.has(pickedId) ? pickedId : model.headId,
);
const folded = $derived.by(() => {
  const keep = new Set([selectedId, ...matches]);
  const result = defaultFoldedBranches(model, keep);
  for (const id of expanded) result.delete(id);
  return result;
});
const layout = $derived(layoutHistoryRows(model, folded));
const gutterWidth = $derived(laneX(layout.laneCount - 1) + 9);
const messageCount = $derived(
  [...model.items.values()].filter((item) => item.node.kind === "user").length,
);
const empty = $derived(model.items.size <= 1);

let listEl = $state<HTMLDivElement>();

function rowElement(id: string): HTMLElement | null | undefined {
  return listEl?.querySelector<HTMLElement>(
    `[data-history-item="${CSS.escape(id)}"]`,
  );
}

async function select(id: string, reveal = true) {
  pickedId = id;
  if (!reveal) return;
  await tick();
  rowElement(id)?.scrollIntoView({ block: "nearest" });
}

// Open on the current message, centred, with keyboard focus in the list.
let centered = false;
$effect(() => {
  if (centered || loading || empty || !listEl) return;
  centered = true;
  void tick().then(() => {
    rowElement(selectedId)?.scrollIntoView({ block: "center" });
    listEl?.focus({ preventScroll: true });
  });
});

async function setMode(next: HistoryMode) {
  mode = next;
  await tick();
  rowElement(selectedId)?.scrollIntoView({ block: "center" });
}

function moveSelection(delta: number) {
  const ids = layout.rows.map((row) => row.itemId);
  const at = Math.max(0, ids.indexOf(selectedId));
  const next = ids[Math.min(ids.length - 1, Math.max(0, at + delta))];
  if (next) void select(next);
}

function stepMatch(delta: number) {
  if (!matchOrder.length) return;
  const at = matchOrder.indexOf(selectedId);
  const next =
    at < 0
      ? delta > 0
        ? matchOrder[0]!
        : matchOrder.at(-1)!
      : matchOrder[(at + delta + matchOrder.length) % matchOrder.length]!;
  void select(next);
}

const canTravel = $derived(!readOnly && !rewindLocked);

function rewindTo(item: HistoryItem) {
  if (!canTravel || item.head) return;
  onRewind(item.id === HISTORY_ROOT_ID ? undefined : item.targetId);
}

function editItem(item: HistoryItem) {
  const entry = item.node.entry;
  if (!canTravel || item.node.kind !== "user" || !entry) return;
  onEdit(entry);
}

function onListKey(event: KeyboardEvent) {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const item = model.items.get(selectedId);
  const row = layout.rows.find((candidate) => candidate.itemId === selectedId);
  switch (event.key) {
    case "ArrowDown":
      moveSelection(1);
      break;
    case "ArrowUp":
      moveSelection(-1);
      break;
    case "Home":
      void select(model.rootId);
      break;
    case "End":
    case "c":
    case "C":
      void select(model.headId);
      break;
    case "ArrowRight":
      if (row?.folded) expanded.add(row.itemId);
      break;
    case "Enter":
      if (row?.folded) expanded.add(row.itemId);
      else if (item) rewindTo(item);
      break;
    case "e":
    case "E":
      if (item) editItem(item);
      break;
    case "Escape":
      onClose();
      break;
    default:
      return;
  }
  event.preventDefault();
}

function rewindLabel(item: HistoryItem): string {
  if (item.id === HISTORY_ROOT_ID) return "Rewind to start";
  return !item.current && item.childIds.length === 0
    ? "Switch to this branch"
    : "Rewind here";
}

function itemText(item: HistoryItem): string {
  const { entry, kind, label, descriptor } = item.node;
  const text = kind === "user" ? entry?.summary || entry?.text : label;
  return text || descriptor?.label || label;
}

function stepsLabel(item: HistoryItem): string {
  return item.steps
    .filter((step) => step.tool)
    .slice(0, 3)
    .map((step) =>
      step.count > 1 ? `${step.label} ×${step.count}` : step.label,
    )
    .join(", ");
}

function turnSummary(item: HistoryItem): string {
  const parts: string[] = [];
  if (item.toolCount)
    parts.push(`${item.toolCount} ${item.toolCount === 1 ? "tool" : "tools"}`);
  const span = historySpanLabel(item.startedAt, item.endedAt);
  if (span) parts.push(span);
  return parts.join(" · ");
}

const lineClass = (current: boolean) =>
  current ? "bg-primary" : "bg-muted-foreground opacity-40";
</script>

{#snippet gutter(row: HistoryRow, item: HistoryItem)}
  <div class="relative shrink-0 self-stretch" style:width={`${gutterWidth}px`}>
    {#each row.pass as segment (segment.lane)}
      <span
        class={["absolute top-0 bottom-0 w-px", lineClass(segment.current)]}
        style:left={`${laneX(segment.lane)}px`}
      ></span>
    {/each}
    {#if row.up !== undefined}
      <span
        class={["absolute top-0 w-px", lineClass(row.up)]}
        style:left={`${laneX(row.lane)}px`}
        style:height={`${DOT_Y}px`}
      ></span>
    {/if}
    {#if row.down !== undefined}
      <span
        class={["absolute bottom-0 w-px", lineClass(row.down)]}
        style:left={`${laneX(row.lane)}px`}
        style:top={`${DOT_Y}px`}
      ></span>
    {/if}
    {#each row.forks as fork (fork.lane)}
      <span
        class={[
          "absolute bottom-0 rounded-tr-md border-t border-r",
          fork.current
            ? "border-primary"
            : "border-muted-foreground opacity-40",
        ]}
        style:left={`${laneX(row.lane)}px`}
        style:top={`${DOT_Y}px`}
        style:width={`${laneX(fork.lane) - laneX(row.lane) + 1}px`}
      ></span>
    {/each}
    <span
      class={[
        "absolute rounded-full border-2",
        item.head
          ? "size-2.5 border-primary bg-primary ring-3 ring-primary-strong"
          : item.node.kind === "user" || item.id === HISTORY_ROOT_ID
            ? "size-2.5 bg-background"
            : "size-2 bg-background",
        !item.head &&
          (item.current ? "border-primary" : "border-muted-foreground"),
        row.folded && "border-dashed",
      ]}
      style:left={`${laneX(row.lane) + 0.5}px`}
      style:top={`${DOT_Y}px`}
      style:transform="translate(-50%, -50%)"
    ></span>
  </div>
{/snippet}

{#snippet actions(item: HistoryItem)}
  {@const later = itemsAfterOnCurrentPath(model, item.id)}
  <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
    {#if !readOnly && !item.head}
      <Button size="sm" disabled={!canTravel} onclick={() => rewindTo(item)}>
        <Undo2 />{rewindLabel(item)}
      </Button>
    {/if}
    {#if !readOnly && item.node.kind === "user"}
      <Button
        size="sm"
        variant="outline"
        disabled={!canTravel}
        onclick={() => editItem(item)}
      >
        <Pencil />Edit & resend
      </Button>
    {/if}
    {#if item.current && item.node.entry}
      <Button
        size="sm"
        variant="ghost"
        onclick={() => onReveal(item.node.entry!.id)}
      >
        <MessagesSquare />Show in conversation
      </Button>
    {/if}
    {#if !readOnly && canTravel && later > 0}
      <span class="text-caption text-muted-foreground">
        Rewinding keeps the {later} later {later === 1 ? "message" : "messages"} as
        a side branch. Files in the workspace are not changed.
      </span>
    {/if}
  </div>
{/snippet}

{#snippet content(row: HistoryRow, item: HistoryItem, selected: boolean)}
  {@const entry = item.node.entry}
  {@const Icon = item.node.descriptor
    ? HISTORY_ICONS[item.node.descriptor.icon]
    : undefined}
  <div class="grid min-w-0 flex-1 gap-0.5 py-1.5">
    {#if row.folded}
      <div
        class="flex min-h-5 min-w-0 items-center gap-1.5 text-ui text-muted-foreground"
      >
        <ChevronRight class="size-3.5 shrink-0" />
        <span class="shrink-0">Side branch · {row.folded.count}</span>
        <span class="truncate">“{itemText(item)}”</span>
      </div>
    {:else if item.id === HISTORY_ROOT_ID}
      <div class="flex min-h-5 items-center text-ui text-muted-foreground">
        Start of conversation
      </div>
      {#if selected && !readOnly && !item.head}
        {@render actions(item)}
      {/if}
    {:else}
      <div class="flex min-h-5 min-w-0 items-start gap-2">
        {#if item.node.kind !== "user" && Icon}
          <Icon class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        {/if}
        <span
          class={[
            "min-w-0 flex-1 text-ui",
            selected
              ? "line-clamp-6 whitespace-pre-wrap break-words"
              : "truncate",
            (!item.current || item.node.kind !== "user") &&
              "text-muted-foreground",
            selected && "text-foreground",
          ]}>{itemText(item)}</span
        >
        {#if item.head}
          <Badge variant="brand">Current</Badge>
        {:else if !item.current && item.childIds.length === 0}
          <Badge>Branch tip</Badge>
        {/if}
        {#if entry}
          <span
            class="shrink-0 text-caption text-muted-foreground tabular-nums"
            title={dateTimeLabel(entry.createdAt)}
            >{relativeTimeLabel(entry.createdAt)}</span
          >
        {/if}
      </div>
      {#if mode === "messages" && item.node.kind === "user"}
        {@const summary = turnSummary(item)}
        {#if summary || item.reply}
          <div
            class="flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground"
          >
            {#if summary}<span class="shrink-0">{summary}</span>{/if}
            {#if summary && item.reply}<span class="shrink-0">—</span>{/if}
            {#if item.reply}
              <span class={selected ? "line-clamp-3" : "truncate"}
                >{item.reply.label}</span
              >
            {/if}
          </div>
        {/if}
      {:else if mode === "steps" && item.toolCount > 0}
        <div class="truncate text-caption text-muted-foreground">
          {item.toolCount}
          {item.toolCount === 1 ? "tool" : "tools"} · {stepsLabel(item)}
        </div>
      {/if}
      {#if selected}
        {@render actions(item)}
      {/if}
    {/if}
  </div>
{/snippet}

<div data-tour-id="conversation-history" class="flex h-full min-h-0 flex-col">
  <div
    class="flex flex-wrap items-center gap-2 border-b border-border-subtle px-3 py-1.5"
  >
    <SearchInput
      bind:value={query}
      placeholder="Search messages"
      ariaLabel="Search messages"
      class="w-56"
      onkeydown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          stepMatch(event.shiftKey ? -1 : 1);
        } else if (event.key === "Escape" && !query) {
          event.preventDefault();
          listEl?.focus();
        }
      }}
    >
      {#snippet trailing()}
        {#if query.trim().length >= 2}
          <span class="shrink-0 text-caption text-muted-foreground tabular-nums"
            >{matchOrder.includes(selectedId)
              ? `${matchOrder.indexOf(selectedId) + 1}/${matches.size}`
              : matches.size}</span
          >
        {/if}
      {/snippet}
    </SearchInput>
    <ToggleGroup.Root
      type="single"
      variant="chip"
      size="sm"
      value={mode}
      aria-label="History detail"
      onValueChange={(value) => {
        if (value === "messages" || value === "steps") void setMode(value);
      }}
    >
      <ToggleGroup.Item value="messages">Messages</ToggleGroup.Item>
      <ToggleGroup.Item value="steps">All steps</ToggleGroup.Item>
    </ToggleGroup.Root>
    <span class="flex-1"></span>
    {#if !empty}
      <span class="text-caption text-muted-foreground tabular-nums">
        {messageCount}
        {messageCount === 1 ? "message" : "messages"} · {tree.branchCount}
        {tree.branchCount === 1 ? "branch" : "branches"}
      </span>
    {/if}
    <IconAction
      icon={LocateFixed}
      label="Jump to current (C)"
      onclick={() => void select(model.headId)}
    />
    <IconAction icon={X} label="Back to conversation (Esc)" onclick={onClose} />
  </div>

  {#if readOnly}
    <Callout
      class="mx-3 mt-2"
      layout="strip"
      icon={Eye}
      text="Sub-agent history is read-only. Rewind from the lead conversation."
    />
  {:else if rewindLocked}
    <Callout
      class="mx-3 mt-2"
      tone="warning"
      layout="strip"
      icon={Square}
      text="Stop the run to rewind or edit. You can still browse."
    />
  {/if}

  {#if empty && loading}
    <div
      class="flex flex-1 items-center justify-center gap-2 text-ui text-muted-foreground"
    >
      <Spinner class="size-4" />Loading history…
    </div>
  {:else if empty}
    <div
      class="flex flex-1 items-center justify-center text-ui text-muted-foreground"
    >
      No messages yet.
    </div>
  {:else}
    <div
      bind:this={listEl}
      class="min-h-0 flex-1 overflow-y-auto px-2 py-2 outline-none"
      role="listbox"
      tabindex="0"
      aria-label="Conversation history"
      aria-activedescendant={`history-item-${selectedId}`}
      onkeydown={onListKey}
    >
      {#each layout.rows as row (row.itemId)}
        {@const item = model.items.get(row.itemId)!}
        {@const selected = row.itemId === selectedId}
        <div
          id={`history-item-${row.itemId}`}
          data-history-item={row.itemId}
          class={[
            "flex cursor-pointer gap-1.5 rounded-md pr-2",
            selected ? "bg-selected" : "hover:bg-hover",
            query.trim().length >= 2 &&
              !matches.has(row.itemId) &&
              "opacity-50",
          ]}
          role="option"
          aria-selected={selected}
          tabindex="-1"
          onclick={() => {
            if (row.folded) expanded.add(row.itemId);
            void select(row.itemId, false);
            listEl?.focus({ preventScroll: true });
          }}
          onkeydown={() => undefined}
        >
          {@render gutter(row, item)}
          {@render content(row, item, selected)}
        </div>
      {/each}
    </div>
  {/if}

  {#if !mobile}
    <div
      class="flex flex-wrap items-center gap-1 border-t border-border-subtle px-3 py-1.5 text-caption text-muted-foreground"
    >
      <Kbd>↑</Kbd><Kbd>↓</Kbd> move
      {#if !readOnly}<Kbd>Enter</Kbd> rewind <Kbd>E</Kbd> edit{/if}
      <Kbd>C</Kbd> current <Kbd>Esc</Kbd> back to conversation
    </div>
  {/if}
</div>
