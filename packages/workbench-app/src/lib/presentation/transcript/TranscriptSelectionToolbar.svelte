<script lang="ts">
import { onDestroy } from "svelte";
import Mic from "@lucide/svelte/icons/mic";
import TextQuote from "@lucide/svelte/icons/text-quote";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type { TranscriptSelectionActions } from "../conversations/conversation-view-contracts.js";
import { selectionToMarkdown, trimBlankLines } from "./selection-markdown.js";
import {
  placeSelectionToolbar,
  type ToolbarPlacement,
} from "./selection-toolbar-position.js";

type Props = {
  /** Element whose selections can be quoted; also the positioning context. */
  container: HTMLElement | undefined;
  actions: TranscriptSelectionActions;
  enabled?: boolean;
};

let { container, actions, enabled = true }: Props = $props();

/** Wait for the selection gesture to settle before offering actions. */
const SETTLE_MS = 220;
const EDITABLE = "input, textarea, select, [contenteditable], .cm-editor";

let placement = $state<ToolbarPlacement>();
let toolbarEl = $state<HTMLDivElement>();
let pointerSelecting = false;
let settleTimer: ReturnType<typeof setTimeout> | undefined;

function clearTimer() {
  if (settleTimer !== undefined) clearTimeout(settleTimer);
  settleTimer = undefined;
}

function hide() {
  clearTimer();
  placement = undefined;
}

function inside(node: Node | null): boolean {
  if (!container || !node) return false;
  const element = node instanceof Element ? node : node.parentElement;
  return Boolean(
    element && container.contains(element) && !element.closest(EDITABLE),
  );
}

/** The selection, when it is non-empty and fully within the transcript. */
function quotableSelection(): Selection | undefined {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return undefined;
  }
  if (!inside(selection.anchorNode) || !inside(selection.focusNode)) {
    return undefined;
  }
  return selection.toString().trim() ? selection : undefined;
}

function show() {
  settleTimer = undefined;
  const selection = quotableSelection();
  if (!enabled || !container || !selection) return hide();
  const range = selection.getRangeAt(selection.rangeCount - 1);
  const box = container.getBoundingClientRect();
  let rect = range.getBoundingClientRect();
  if (rect.top < box.top) {
    // Long selections scroll out of view; anchor to the visible end instead.
    const rects = range.getClientRects();
    rect = rects[rects.length - 1] ?? rect;
  }
  if (rect.bottom < box.top || rect.top > box.bottom) return hide();
  placement = placeSelectionToolbar(rect, box, {
    width: toolbarEl?.offsetWidth || 132,
    height: toolbarEl?.offsetHeight || 32,
  });
}

function schedule() {
  clearTimer();
  settleTimer = setTimeout(show, SETTLE_MS);
}

function onPointerDown(event: PointerEvent) {
  if (toolbarEl?.contains(event.target as Node)) return;
  hide();
  pointerSelecting = event.button === 0 && inside(event.target as Node);
}

function onPointerUp() {
  if (!pointerSelecting) return;
  pointerSelecting = false;
  schedule();
}

function onKeyUp(event: KeyboardEvent) {
  if (event.key === "Escape") return hide();
  if (event.shiftKey || ((event.ctrlKey || event.metaKey) && event.key === "a"))
    schedule();
}

function onSelectionChange() {
  // Only dismiss here; showing waits for pointer/key release.
  if (placement && !quotableSelection()) hide();
}

function onScroll(event: Event) {
  if (placement && container?.contains(event.target as Node)) hide();
}

function run(action: ((markdown: string) => void) | undefined) {
  const selection = quotableSelection();
  if (!action || !selection) return hide();
  const markdown =
    selectionToMarkdown(selection) || trimBlankLines(selection.toString());
  selection.removeAllRanges();
  hide();
  if (markdown) action(markdown);
}

$effect(() => {
  if (!enabled) hide();
});

$effect(() => {
  if (!container) return;
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("pointerup", onPointerUp, true);
  document.addEventListener("keyup", onKeyUp, true);
  document.addEventListener("selectionchange", onSelectionChange);
  document.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", hide);
  window.addEventListener("blur", hide);
  return () => {
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("pointerup", onPointerUp, true);
    document.removeEventListener("keyup", onKeyUp, true);
    document.removeEventListener("selectionchange", onSelectionChange);
    document.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", hide);
    window.removeEventListener("blur", hide);
    hide();
  };
});

onDestroy(clearTimer);
</script>

{#if placement}
  <div
    bind:this={toolbarEl}
    role="toolbar"
    aria-label="Selection actions"
    tabindex="-1"
    class="absolute z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-md border bg-popover p-0.5 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95 duration-150"
    style:left="{placement.x}px"
    style:top="{placement.y}px"
    onpointerdown={(event) => event.preventDefault()}
  >
    <Button
      variant="ghost"
      size="sm"
      title="Quote in composer"
      onclick={() => run(actions.quote)}
    >
      <TextQuote aria-hidden="true" />Quote
    </Button>
    {#if actions.quoteAndDictate}
      <Button
        variant="ghost"
        size="icon-sm"
        ariaLabel="Quote and dictate"
        title="Quote and dictate"
        onclick={() => run(actions.quoteAndDictate)}
      >
        <Mic aria-hidden="true" />
      </Button>
    {/if}
  </div>
{/if}
