<script lang="ts">
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import GitFork from "@lucide/svelte/icons/git-fork";
import Eye from "@lucide/svelte/icons/eye";
import LocateFixed from "@lucide/svelte/icons/locate-fixed";
import MessagesSquare from "@lucide/svelte/icons/messages-square";
import Pencil from "@lucide/svelte/icons/pencil";
import Square from "@lucide/svelte/icons/square";
import Undo2 from "@lucide/svelte/icons/undo-2";
import X from "@lucide/svelte/icons/x";
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import { scrollEdges } from "@nervekit/ui-kit/components/composites/scroll-region";
import { SearchInput } from "@nervekit/ui-kit/components/composites/search-input";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
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
import { plainPreview } from "./history-graph";
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
  /** Start a new conversation from the path up to this entry. */
  onFork?: (entryId: string) => void;
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
  onFork,
  onReveal,
  onClose,
}: Props = $props();

const LANE = 22;
/** Vertical centre of a row's first line, where its dot sits. */
const DOT_Y = 16;
const laneX = (lane: number) => 11 + lane * LANE;

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
const gutterWidth = $derived(laneX(layout.laneCount - 1) + 12);
const messageCount = $derived(
  [...model.items.values()].filter((item) => item.node.kind === "user").length,
);
const empty = $derived(model.items.size <= 1);

let listEl = $state<HTMLDivElement>();
// Edge fades say there is more above or below, as in the transcript.
let canScrollUp = $state(false);
let canScrollDown = $state(false);
$effect(() => {
  const element = listEl;
  if (!element) return;
  const update = () => {
    const edges = scrollEdges(element);
    canScrollUp = edges.top;
    canScrollDown = edges.bottom;
  };
  update();
  element.addEventListener("scroll", update, { passive: true });
  const observer = new ResizeObserver(update);
  observer.observe(element);
  if (element.firstElementChild) observer.observe(element.firstElementChild);
  return () => {
    element.removeEventListener("scroll", update);
    observer.disconnect();
  };
});

function rowElement(id: string): HTMLElement | null | undefined {
  return listEl?.querySelector<HTMLElement>(
    `[data-history-item="${CSS.escape(id)}"]`,
  );
}

const reducedMotion =
  typeof matchMedia === "function"
    ? matchMedia("(prefers-reduced-motion: reduce)")
    : undefined;

/**
 * Select a row, growing it and shrinking the previous one smoothly: heights
 * are captured before the change and animated to the rendered result. An
 * interrupted animation continues from the height on screen.
 */
async function select(id: string, reveal = true) {
  const affected = [...new Set([selectedId, id])];
  const before = new Map(
    affected.map((rowId) => [
      rowId,
      rowElement(rowId)?.getBoundingClientRect().height,
    ]),
  );
  pickedId = id;
  await tick();
  const finished: Promise<unknown>[] = [];
  for (const [rowId, from] of before) {
    const element = rowElement(rowId);
    if (!element || from === undefined || reducedMotion?.matches) continue;
    for (const running of element.getAnimations()) running.cancel();
    const to = element.getBoundingClientRect().height;
    if (Math.abs(to - from) < 1) continue;
    const animation = element.animate(
      [
        { height: `${from}px`, overflow: "hidden" },
        { height: `${to}px`, overflow: "hidden" },
      ],
      { duration: 180, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
    );
    finished.push(animation.finished.catch(() => undefined));
  }
  if (!reveal) return;
  await Promise.all(finished);
  if (pickedId === id) rowElement(id)?.scrollIntoView({ block: "nearest" });
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

/** Rewinds land on replies (or the start); a message is edited instead. */
const canRewind = (item: HistoryItem) =>
  !item.head && (item.id === HISTORY_ROOT_ID || item.node.kind !== "user");

function rewindTo(item: HistoryItem) {
  if (!canTravel || !canRewind(item)) return;
  onRewind(item.id === HISTORY_ROOT_ID ? undefined : item.targetId);
}

/** Forks land on replies, including the current head; never the start. */
const canFork = (item: HistoryItem) =>
  Boolean(onFork) && item.id !== HISTORY_ROOT_ID && item.node.kind !== "user";

function forkFrom(item: HistoryItem) {
  if (!canTravel || !canFork(item)) return;
  onFork?.(item.targetId);
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
  {@const Marker =
    item.id === HISTORY_ROOT_ID
      ? undefined
      : item.node.kind === "user"
        ? HISTORY_ICONS.user
        : item.node.descriptor?.type === "assistant" || !item.node.descriptor
          ? HISTORY_ICONS.sparkles
          : HISTORY_ICONS[item.node.descriptor.icon]}
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
        "absolute flex items-center justify-center rounded-full border",
        Marker ? "size-5" : "size-2.5 border-2",
        // Your messages are info-toned, the agent's replies brand-toned.
        item.node.kind === "user"
          ? item.head
            ? "border-info bg-info text-info-foreground"
            : item.current
              ? "border-info bg-background text-info"
              : "border-muted-foreground bg-background text-muted-foreground"
          : item.head
            ? "border-primary bg-primary text-primary-foreground"
            : item.current
              ? "border-primary bg-background text-primary"
              : "border-muted-foreground bg-background text-muted-foreground",
        row.folded && "border-dashed",
      ]}
      style:left={`${laneX(row.lane) + 0.5}px`}
      style:top={`${DOT_Y}px`}
      style:transform="translate(-50%, -50%)"
      aria-hidden="true"
    >
      {#if Marker}<Marker class="size-3" />{/if}
    </span>
  </div>
{/snippet}

{#snippet actions(item: HistoryItem)}
  {@const later = itemsAfterOnCurrentPath(model, item.id)}
  <div class="flex flex-wrap items-center gap-1.5 pt-1">
    {#if !readOnly && canRewind(item)}
      <Button
        size="sm"
        disabled={!canTravel}
        title={later > 0
          ? `The ${later} later ${later === 1 ? "message stays" : "messages stay"} as a side branch. Workspace files are not changed.`
          : "Workspace files are not changed."}
        onclick={() => rewindTo(item)}
      >
        <Undo2 />{rewindLabel(item)}
      </Button>
    {/if}
    {#if !readOnly && canFork(item)}
      <Button
        size="sm"
        variant="outline"
        disabled={!canTravel}
        title="Start a new conversation from here. This one is not changed."
        onclick={() => forkFrom(item)}
      >
        <GitFork />Fork here
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
  </div>
{/snippet}

{#snippet meta(text: string)}
  {#if text}
    <span class="shrink-0 text-caption text-muted-foreground tabular-nums"
      >{text}</span
    >
  {/if}
{/snippet}

{#snippet when(item: HistoryItem)}
  {@const entry = item.node.entry}
  {#if item.head}
    <Badge variant="brand">Current</Badge>
  {:else if !item.current && item.childIds.length === 0}
    <Badge>Branch tip</Badge>
  {/if}
  {#if entry}
    <span
      class="w-7 shrink-0 text-right text-caption text-muted-foreground tabular-nums"
      title={dateTimeLabel(entry.createdAt)}
      >{relativeTimeLabel(entry.createdAt)}</span
    >
  {/if}
{/snippet}

{#snippet content(row: HistoryRow, item: HistoryItem, selected: boolean)}
  {@const user = item.node.kind === "user"}
  {@const summary = user ? "" : turnSummary(item)}
  <div class="grid min-w-0 flex-1 gap-1.5 py-1.5">
    {#if row.folded}
      <div
        class="flex min-h-5 min-w-0 items-center gap-1.5 text-ui text-muted-foreground"
      >
        <ChevronRight class="size-3.5 shrink-0" />
        <span class="shrink-0">Side branch · {row.folded.count}</span>
        <span class="truncate">“{plainPreview(itemText(item))}”</span>
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
        <span
          class={[
            "min-w-0 flex-1 text-ui break-words",
            selected
              ? user
                ? "line-clamp-8 whitespace-pre-wrap"
                : "line-clamp-6"
              : "truncate",
            (!user || !item.current) && !selected && "text-muted-foreground",
          ]}
          >{selected && user
            ? itemText(item)
            : plainPreview(itemText(item))}</span
        >
        <div class="flex shrink-0 items-center gap-2">
          {@render meta(summary)}
          {@render when(item)}
        </div>
      </div>
      {#if selected}
        {#if mode === "steps" && !user && item.toolCount > 0}
          <p class="truncate text-caption text-muted-foreground">
            {stepsLabel(item)}
          </p>
        {/if}
        {@render actions(item)}
      {/if}
    {/if}
  </div>
{/snippet}

<div data-tour-id="conversation-history" class="flex h-full min-h-0 flex-col">
  <div
    class="flex flex-wrap items-center gap-2 border-b border-border-subtle py-1.5 pr-[calc(var(--conversation-content-inset,1.5rem)+var(--conversation-scrollbar-lane,0px))] pl-(--conversation-content-inset,1.5rem)"
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
      class="mt-2 mr-[calc(var(--conversation-content-inset,1.5rem)+var(--conversation-scrollbar-lane,0px))] ml-(--conversation-content-inset,1.5rem)"
      layout="strip"
      icon={Eye}
      text="Sub-agent history is read-only. Rewind from the lead conversation."
    />
  {:else if rewindLocked}
    <Callout
      class="mt-2 mr-[calc(var(--conversation-content-inset,1.5rem)+var(--conversation-scrollbar-lane,0px))] ml-(--conversation-content-inset,1.5rem)"
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
    <div class="relative isolate flex min-h-0 flex-1 flex-col">
      <div
        bind:this={listEl}
        class="min-h-0 flex-1 overflow-y-auto px-(--conversation-content-inset,1.5rem) py-2 outline-none [scrollbar-gutter:stable]"
        role="listbox"
        tabindex="0"
        aria-label="Conversation history"
        aria-activedescendant={`history-item-${selectedId}`}
        onkeydown={onListKey}
      >
        <div role="none">
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
      </div>
      <div
        class="pointer-events-none absolute top-0 right-3 left-0 z-2 h-6 bg-linear-to-b from-background to-transparent opacity-0 transition-opacity duration-150"
        class:opacity-100={canScrollUp}
        aria-hidden="true"
      ></div>
      <div
        class="pointer-events-none absolute right-3 bottom-0 left-0 z-2 h-6 bg-linear-to-t from-background to-transparent opacity-0 transition-opacity duration-150"
        class:opacity-100={canScrollDown}
        aria-hidden="true"
      ></div>
    </div>
  {/if}
</div>
