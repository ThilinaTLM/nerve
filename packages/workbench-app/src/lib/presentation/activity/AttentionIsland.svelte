<!--
  @component
  The titlebar bell while something waits for the user. It morphs in place:
  Arrival (one line for a new item), Compact (icon and count of the highest
  level waiting) and Expanded (the lists, growing down from the titlebar).
  The host owns the state; this draws it and reports what the user chose.
-->
<script lang="ts">
import BellDot from "@lucide/svelte/icons/bell-dot";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import ChevronUp from "@lucide/svelte/icons/chevron-up";
import MessageCircleQuestionMark from "@lucide/svelte/icons/message-circle-question-mark";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import { prefersReducedMotion } from "svelte/motion";
import { fade } from "svelte/transition";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import { GroupLabel } from "@nervekit/ui-kit/components/composites/group-label";
import {
  rowIn,
  rowOut,
} from "@nervekit/ui-kit/components/composites/floating-toolbar";
import {
  highestLevel,
  type IslandArrivalRow,
  type IslandConversationRow,
  type IslandTrustRow,
} from "./attention-island";

let {
  phase,
  arrival,
  trust,
  conversations,
  onExpand,
  onCollapse,
  onLater,
  onReview,
  onReviewAll,
  onOpenConversation,
  onAllNotifications,
  onHover,
}: {
  phase: "arrival" | "compact" | "expanded";
  /** The item arriving; without it an `arrival` phase draws Compact. */
  arrival?: IslandArrivalRow;
  trust: readonly IslandTrustRow[];
  conversations: readonly IslandConversationRow[];
  onExpand: () => void;
  onCollapse: () => void;
  onLater: () => void;
  onReview: (row: IslandTrustRow) => void;
  onReviewAll: () => void;
  onOpenConversation: (row: IslandConversationRow) => void;
  onAllNotifications: () => void;
  /** The pointer is over the island: an arrival holds. */
  onHover?: (hovered: boolean) => void;
} = $props();

const view = $derived(
  phase === "arrival" && arrival
    ? "arrival"
    : phase === "expanded"
      ? "expanded"
      : "compact",
);
const count = $derived(trust.length);
const level = $derived(
  highestLevel({ trust: trust.length, conversations: conversations.length }),
);

let compactWidth = $state(0);
let contentWidth = $state(0);
let contentHeight = $state(0);
let slotHeight = $state(0);
/* The box is exactly its content (the frame is an inset outline), so Compact
   and Arrival are the titlebar icon button's height. The slot keeps the
   compact width while expanded, so the other icons stay put and the island
   hangs below the titlebar. */
const slotWidth = $derived(view === "expanded" ? compactWidth : contentWidth);
const boxTop = $derived(
  view === "expanded" ? 0 : (slotHeight - contentHeight) / 2,
);

// Unmounting under the pointer fires no mouseleave; let the arrival settle.
$effect(() => () => onHover?.(false));

function motionMs(node: Element, scale = 1): number {
  if (prefersReducedMotion.current) return 0;
  const token = getComputedStyle(node).getPropertyValue(
    "--motion-enter-duration",
  );
  return (parseFloat(token) || 0) * scale;
}
function islandFade(node: Element) {
  return fade(node, {
    duration: motionMs(node, 0.8),
    delay: motionMs(node, 0.35),
  });
}

/* Escape or a click outside folds the list back. The transcript marker
   counts as inside: it opens the list. */
function inside(event: Event): boolean {
  return event
    .composedPath()
    .some(
      (node) =>
        node instanceof HTMLElement &&
        node.dataset.attentionIsland !== undefined,
    );
}
function onWindowPointer(event: PointerEvent): void {
  if (view === "expanded" && !inside(event)) onCollapse();
}
function onWindowKey(event: KeyboardEvent): void {
  if (view === "expanded" && event.key === "Escape") onCollapse();
}

const compactLabel = $derived(
  [
    count ? `${count} to review` : "",
    conversations.length
      ? `${conversations.length} ${conversations.length === 1 ? "conversation" : "conversations"} waiting`
      : "",
  ]
    .filter(Boolean)
    .join(", "),
);

const rowClass =
  "group/item flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus";
const tileClass =
  "flex size-7 flex-none items-center justify-center self-start rounded-md border bg-card";
const arrivalTextClass =
  "flex min-w-0 cursor-pointer items-center gap-1.5 text-left text-ui whitespace-nowrap focus-visible:outline-2 focus-visible:outline-focus";
</script>

<svelte:window onpointerdown={onWindowPointer} onkeydown={onWindowKey} />

<div
  class="relative h-control flex-none transition-[width] duration-(--motion-enter-duration) ease-(--motion-enter-easing) motion-reduce:transition-none"
  style:width={`${slotWidth}px`}
  bind:clientHeight={slotHeight}
  data-attention-island
>
  <div
    class="invisible absolute top-0 right-0 w-max"
    aria-hidden="true"
    inert
    bind:clientWidth={compactWidth}
  >
    {@render compact()}
  </div>
  <div
    class={[
      "absolute right-0 z-40 overflow-hidden outline -outline-offset-1 transition-[width,height,top,box-shadow,background-color,outline-color,border-radius] duration-(--motion-enter-duration) ease-(--motion-enter-easing) motion-reduce:transition-none",
      view === "compact"
        ? "rounded-md bg-transparent outline-transparent"
        : view === "arrival"
          ? "rounded-md bg-popover text-popover-foreground shadow-overlay outline-border"
          : "rounded-xl bg-popover text-popover-foreground shadow-overlay outline-border",
    ]}
    style:width={`${contentWidth}px`}
    style:height={`${contentHeight}px`}
    style:top={`${boxTop}px`}
    role="region"
    aria-label="Waiting for you"
    onmouseenter={() => onHover?.(true)}
    onmouseleave={() => onHover?.(false)}
  >
    <div
      class="absolute top-0 right-0 w-max"
      bind:clientWidth={contentWidth}
      bind:clientHeight={contentHeight}
    >
      {#key `${view}:${view === "arrival" ? arrival?.row.key : ""}`}
        <div in:islandFade>
          {#if view === "arrival" && arrival?.level === "trust"}
            {@render arrivalTrust(arrival.row)}
          {:else if view === "arrival" && arrival?.level === "conversation"}
            {@render arrivalConversation(arrival.row)}
          {:else if view === "expanded"}
            {@render expanded()}
          {:else}
            {@render compact()}
          {/if}
        </div>
      {/key}
    </div>
  </div>
</div>

<!-- Compact: the titlebar icon button's size, icon and count of the highest
     level waiting: trust (warning) over conversations (info). -->
{#snippet compact()}
  <button
    type="button"
    class="flex h-control min-w-control cursor-pointer items-center justify-center gap-1 rounded-md px-1.5 text-ui font-medium whitespace-nowrap tabular-nums hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus"
    aria-label={`${compactLabel}, show the list`}
    title="Waiting for you"
    onclick={onExpand}
  >
    {#if level === "trust"}
      <BellDot class="size-4 text-warning" aria-hidden="true" />
      <span class="text-warning">{count}</span>
    {:else}
      <MessageCircleQuestionMark class="size-4 text-info" aria-hidden="true" />
      <span class="text-info">{conversations.length}</span>
    {/if}
  </button>
{/snippet}

{#snippet arrivalTrust(row: IslandTrustRow)}
  <div class="flex h-control max-w-96 items-center gap-2 pr-0.5 pl-2">
    <button
      type="button"
      class={arrivalTextClass}
      aria-label={`New: ${row.name}, ${row.kindLabel}. Show all waiting items`}
      onclick={onExpand}
    >
      <row.icon class="size-4 shrink-0 text-warning" aria-hidden="true" />
      <span class="max-w-40 shrink-0 truncate font-medium">{row.name}</span>
      {#if row.risk}
        <span class="flex min-w-0 items-center gap-1 text-warning">
          <TriangleAlert class="size-3 shrink-0" aria-hidden="true" />
          <span class="truncate">{row.risk}</span>
        </span>
      {:else}
        <span class="min-w-0 truncate text-muted-foreground"
          >needs your review</span
        >
      {/if}
    </button>
    <Button size="sm" onclick={() => onReview(row)}>Review</Button>
  </div>
{/snippet}

{#snippet arrivalConversation(row: IslandConversationRow)}
  <div class="flex h-control max-w-96 items-center gap-2 pr-0.5 pl-2">
    <button
      type="button"
      class={arrivalTextClass}
      aria-label={`${row.title} ${row.waits}. Show all waiting items`}
      onclick={onExpand}
    >
      <row.icon class="size-4 shrink-0 text-info" aria-hidden="true" />
      <span class="max-w-48 shrink-0 truncate font-medium">{row.title}</span>
      <span class="min-w-0 truncate text-muted-foreground">{row.waits}</span>
    </button>
    <Button size="sm" onclick={() => onOpenConversation(row)}>Open</Button>
  </div>
{/snippet}

{#snippet expanded()}
  <div class="flex w-96 flex-col">
    <div class="flex h-control items-center gap-2 pr-0.5 pl-3">
      <span class="min-w-0 flex-1 truncate text-ui font-medium"
        >Waiting for you</span
      >
      <IconAction icon={ChevronUp} label="Collapse" onclick={onCollapse} />
    </div>
    <div
      class="max-h-112 overflow-y-auto overscroll-contain border-t border-border-subtle p-0.5"
    >
      {#if count}
        <GroupLabel
          label="Needs your review"
          {count}
          icon={BellDot}
          class="px-2 pt-1.5 pb-0.5 text-warning"
        />
        <div class="flex flex-col" role="list" aria-label="Needs your review">
          {#each trust as row (row.key)}
            <div role="listitem" in:rowIn out:rowOut>
              <button
                type="button"
                class={rowClass}
                aria-label={`Review ${row.name}`}
                onclick={() => onReview(row)}
              >
                <span class={[tileClass, "text-foreground"]}>
                  <row.icon class="size-3.5" aria-hidden="true" />
                </span>
                <span class="grid min-w-0 flex-1">
                  <span class="truncate text-ui text-foreground"
                    >{row.name}</span
                  >
                  {#if row.risk}
                    <span
                      class="flex min-w-0 items-center gap-1 text-caption text-warning"
                    >
                      <TriangleAlert
                        class="size-3 flex-none"
                        aria-hidden="true"
                      />
                      <span class="truncate">{row.risk}</span>
                    </span>
                  {/if}
                  <span class="truncate text-caption text-muted-foreground"
                    >{[row.kindLabel, row.scopeLabel, row.changed]
                      .filter(Boolean)
                      .join(" · ")}</span
                  >
                </span>
                <ChevronRight
                  class="size-4 flex-none text-muted-foreground transition-transform group-hover/item:translate-x-0.5"
                  aria-hidden="true"
                />
              </button>
            </div>
          {/each}
        </div>
      {/if}
      {#if conversations.length}
        <GroupLabel
          label="Conversations waiting"
          count={conversations.length}
          icon={MessageCircleQuestionMark}
          class={["px-2 pb-0.5", count ? "pt-2.5" : "pt-1.5"].join(" ")}
        />
        <div
          class="flex flex-col"
          role="list"
          aria-label="Conversations waiting"
        >
          {#each conversations as row (row.key)}
            <div role="listitem" in:rowIn out:rowOut>
              <button
                type="button"
                class={rowClass}
                aria-label={`Open ${row.title}`}
                onclick={() => onOpenConversation(row)}
              >
                <span class={[tileClass, "text-info"]}>
                  <row.icon class="size-3.5" aria-hidden="true" />
                </span>
                <span class="grid min-w-0 flex-1">
                  <span class="truncate text-ui text-foreground"
                    >{row.title}</span
                  >
                  <span class="truncate text-caption text-muted-foreground"
                    >{[row.project, row.waits, row.time]
                      .filter(Boolean)
                      .join(" · ")}</span
                  >
                </span>
                <ChevronRight
                  class="size-4 flex-none text-muted-foreground transition-transform group-hover/item:translate-x-0.5"
                  aria-hidden="true"
                />
              </button>
            </div>
          {/each}
        </div>
      {/if}
    </div>
    <div
      class="flex items-center gap-1 border-t border-border-subtle px-1.5 py-1.5"
    >
      <Button variant="ghost" size="sm" onclick={onAllNotifications}
        >All notifications</Button
      >
      <span class="flex-1"></span>
      <Button variant="ghost" size="sm" onclick={onLater}>Later</Button>
      {#if count}
        <Button size="sm" onclick={onReviewAll}>Review all ({count})</Button>
      {/if}
    </div>
  </div>
{/snippet}
