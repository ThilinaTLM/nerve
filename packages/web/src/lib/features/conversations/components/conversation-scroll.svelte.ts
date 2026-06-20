import { tick } from "svelte";
import type {
  VirtualScrollBehavior,
  VirtualScrollerController,
} from "$lib/components/ui/virtual-list";

const MAX_SETTLE_FRAMES = 30;
// Above this distance from the bottom, a smooth animation would have to mount
// and measure every row on the way down (O(n) for long conversations); snap
// instantly instead. Below it, the in-between rows are already measured so a
// short smooth scroll stays cheap and feels nicer.
const SMOOTH_JUMP_MAX_PX = 2400;

type ConversationScrollControllerOptions = {
  conversationOpen: () => boolean;
  conversationId: () => string | undefined;
  /** True once the opened conversation has rendered at least one row. */
  contentReady: () => boolean;
};

/**
 * Slim, virtualizer-driven scroll coordinator. The heavy lifting (stick-to-end,
 * follow-on-append, "don't yank while reading history") is handled by the
 * VirtualScroller's `anchorTo: 'end'` + `followOnAppend`. This controller only:
 *  - measures the docked composer height (for the jump-to-latest button offset),
 *  - exposes the bound VirtualScroller controller + `atEnd` flag,
 *  - scrolls to the end once when a conversation is opened/switched.
 */
export function createConversationScrollController(
  options: ConversationScrollControllerOptions,
) {
  let composerWrapEl = $state<HTMLDivElement>();
  let composerHeight = $state(0);
  let controller = $state<VirtualScrollerController>();
  let atEnd = $state(true);
  let lastConversationId: string | undefined;
  let initialScrollDone = false;

  function scrollToEnd(opts?: { behavior?: VirtualScrollBehavior }): void {
    controller?.scrollToEnd(opts);
  }

  // Jump-to-latest button handler: snap instantly from far away (fast, avoids
  // measuring every intermediate row), smooth-scroll only when already close.
  function jumpToBottom(): void {
    const ctrl = controller;
    if (!ctrl) return;
    if (ctrl.getDistanceFromEnd() <= SMOOTH_JUMP_MAX_PX) {
      ctrl.scrollToEnd({ behavior: "smooth" });
    } else {
      scrollToEndWhenSettled();
    }
  }

  // Land at the bottom when a conversation is opened/switched. Row heights are
  // estimates until measured, so total size keeps growing for a few frames; we
  // re-anchor each frame until the viewport is actually at the end (or a short
  // cap elapses). This also tolerates the controller binding slightly after
  // this effect first runs.
  function scrollToEndWhenSettled() {
    let frames = 0;
    const step = () => {
      frames += 1;
      const ctrl = controller;
      if (!ctrl) {
        if (frames < MAX_SETTLE_FRAMES) requestAnimationFrame(step);
        return;
      }
      ctrl.scrollToEnd({ behavior: "instant" });
      if (!ctrl.isAtEnd() && frames < MAX_SETTLE_FRAMES) {
        requestAnimationFrame(step);
      }
    };
    requestAnimationFrame(step);
  }

  $effect(() => {
    const conversationId = options.conversationId();
    const ready = options.contentReady();
    if (conversationId !== lastConversationId) {
      lastConversationId = conversationId;
      initialScrollDone = false;
    }
    // Wait for the opened conversation's transcript to populate (it loads after
    // the conversation id changes); scroll to the bottom exactly once it has.
    if (!conversationId || initialScrollDone || !ready) return;
    initialScrollDone = true;
    void tick().then(scrollToEndWhenSettled);
  });

  $effect(() => {
    const el = composerWrapEl;
    if (!el || typeof ResizeObserver === "undefined") return;

    const updateComposerHeight = () => {
      composerHeight = el.offsetHeight;
    };
    updateComposerHeight();

    const observer = new ResizeObserver(updateComposerHeight);
    observer.observe(el);

    return () => observer.disconnect();
  });

  return {
    get composerWrapEl() {
      return composerWrapEl;
    },
    set composerWrapEl(value: HTMLDivElement | undefined) {
      composerWrapEl = value;
    },
    get composerHeight() {
      return composerHeight;
    },
    get controller() {
      return controller;
    },
    set controller(value: VirtualScrollerController | undefined) {
      controller = value;
    },
    get atEnd() {
      return atEnd;
    },
    set atEnd(value: boolean) {
      atEnd = value;
    },
    scrollToEnd,
    jumpToBottom,
  };
}
