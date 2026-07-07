import type {
  VirtualScrollBehavior,
  VirtualScrollerController,
} from "@nervekit/ui/components/ui/virtual-list";
import { tick } from "svelte";
import { shouldDisableFollowForScroll } from "./conversation-scroll-intent";

const MAX_SETTLE_FRAMES = 30;
// Above this distance from the bottom, a smooth animation would have to mount
// and measure every row on the way down (O(n) for long conversations); snap
// instantly instead. Below it, the in-between rows are already measured so a
// short smooth scroll stays cheap and feels nicer.
const SMOOTH_JUMP_MAX_PX = 2400;
const BOTTOM_THRESHOLD_PX = 32;
const USER_SCROLL_AWAY_THRESHOLD_PX = 100;
const USER_SCROLL_INTENT_TIMEOUT_MS = 350;
const PROGRAMMATIC_SCROLL_GUARD_MS = 120;
const SCROLL_DIRECTION_EPSILON_PX = 1;

const SCROLL_KEYS = new Set([
  "ArrowDown",
  "ArrowUp",
  "End",
  "Home",
  "PageDown",
  "PageUp",
  " ",
]);
const SCROLL_AWAY_KEYS = new Set(["ArrowUp", "Home", "PageUp"]);

type ConversationScrollControllerOptions = {
  /** Whether this pane is currently visible/interactive. Hidden kept-mounted
   * panes should not chase bottom anchoring or resize composer affordances. */
  active?: () => boolean;
  conversationOpen: () => boolean;
  conversationId: () => string | undefined;
  /** True once the opened conversation has rendered at least one row. */
  contentReady: () => boolean;
};

function distanceFromDomEnd(el: HTMLElement): number {
  return Math.max(el.scrollHeight - el.clientHeight - el.scrollTop, 0);
}

function isDomAtEnd(el: HTMLElement, threshold = BOTTOM_THRESHOLD_PX): boolean {
  return distanceFromDomEnd(el) <= threshold;
}

function isVerticalScrollbarPointer(
  event: PointerEvent,
  el: HTMLElement,
): boolean {
  if (el.scrollHeight <= el.clientHeight) return false;

  const scrollbarWidth = el.offsetWidth - el.clientWidth;
  if (scrollbarWidth <= 0) return false;

  const rect = el.getBoundingClientRect();
  return (
    event.clientX >= rect.right - scrollbarWidth &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom
  );
}

/**
 * Slim, virtualizer-driven scroll coordinator. The VirtualScroller handles
 * end anchoring and dynamic measurement; this controller owns the user's
 * explicit follow-bottom intent. `atEnd` is a viewport measurement,
 * `followBottom` is whether new output should keep the transcript pinned.
 */
export function createConversationScrollController(
  options: ConversationScrollControllerOptions,
) {
  let composerWrapEl = $state<HTMLDivElement>();
  let composerHeight = $state(0);
  let controller = $state<VirtualScrollerController>();
  let atEnd = $state(true);
  let followBottom = $state(true);
  let lastConversationId: string | undefined;
  let lastActive = false;
  let initialScrollDone = false;
  let settleFrame: number | undefined;
  let userScrollAwayIntent = false;
  let userScrollIntentTimer: ReturnType<typeof setTimeout> | undefined;
  let programmaticScrollActive = false;
  let programmaticScrollTimer: ReturnType<typeof setTimeout> | undefined;

  function clearUserScrollIntentTimer() {
    if (userScrollIntentTimer === undefined) return;
    clearTimeout(userScrollIntentTimer);
    userScrollIntentTimer = undefined;
  }

  function clearProgrammaticScrollTimer() {
    if (programmaticScrollTimer === undefined) return;
    clearTimeout(programmaticScrollTimer);
    programmaticScrollTimer = undefined;
  }

  function markProgrammaticScroll() {
    programmaticScrollActive = true;
    clearProgrammaticScrollTimer();
    programmaticScrollTimer = setTimeout(() => {
      programmaticScrollActive = false;
      programmaticScrollTimer = undefined;
    }, PROGRAMMATIC_SCROLL_GUARD_MS);
  }

  function cancelSettledScroll() {
    if (settleFrame === undefined) return;
    cancelAnimationFrame(settleFrame);
    settleFrame = undefined;
  }

  function scrollToEnd(opts?: { behavior?: VirtualScrollBehavior }): void {
    markProgrammaticScroll();
    controller?.scrollToEnd(opts);
  }

  function updateFollowFromUserScroll(viewport?: HTMLElement | null) {
    const ctrl = controller;
    if (viewport) {
      if (isDomAtEnd(viewport, BOTTOM_THRESHOLD_PX)) {
        followBottom = true;
        return;
      }
      if (
        userScrollAwayIntent &&
        distanceFromDomEnd(viewport) > USER_SCROLL_AWAY_THRESHOLD_PX
      ) {
        followBottom = false;
        cancelSettledScroll();
      }
      return;
    }

    if (ctrl?.isAtEnd(BOTTOM_THRESHOLD_PX)) {
      followBottom = true;
      return;
    }
    if (
      userScrollAwayIntent &&
      (ctrl?.getDistanceFromEnd() ?? 0) > USER_SCROLL_AWAY_THRESHOLD_PX
    ) {
      followBottom = false;
      cancelSettledScroll();
    }
  }

  function disableFollowForManualScroll() {
    followBottom = false;
    cancelSettledScroll();
  }

  function markUserScrollIntent(options?: {
    disableFollowImmediately?: boolean;
    scrollAwayIntent?: boolean;
    viewport?: HTMLElement | null;
  }) {
    if (programmaticScrollActive) return;
    userScrollAwayIntent =
      options?.scrollAwayIntent ?? Boolean(options?.disableFollowImmediately);
    if (options?.disableFollowImmediately) {
      // Disable before the browser applies the scroll delta. Otherwise an
      // already-scheduled pinned-follow frame can pull the viewport back to the
      // bottom, making it feel impossible to scroll up while output streams.
      disableFollowForManualScroll();
    }
    clearUserScrollIntentTimer();
    userScrollIntentTimer = setTimeout(() => {
      userScrollAwayIntent = false;
      userScrollIntentTimer = undefined;
    }, USER_SCROLL_INTENT_TIMEOUT_MS);
    requestAnimationFrame(() => updateFollowFromUserScroll(options?.viewport));
  }

  // Jump-to-latest button handler: snap instantly from far away (fast, avoids
  // measuring every intermediate row), smooth-scroll only when already close.
  function jumpToBottom(): void {
    const ctrl = controller;
    if (!ctrl) return;
    followBottom = true;
    if (ctrl.getDistanceFromEnd() <= SMOOTH_JUMP_MAX_PX) {
      scrollToEnd({ behavior: "smooth" });
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
    cancelSettledScroll();
    followBottom = true;
    let frames = 0;
    const step = () => {
      settleFrame = undefined;
      frames += 1;
      const ctrl = controller;
      if (!ctrl) {
        if (frames < MAX_SETTLE_FRAMES) {
          settleFrame = requestAnimationFrame(step);
        }
        return;
      }
      scrollToEnd({ behavior: "instant" });
      if (!ctrl.isAtEnd(BOTTOM_THRESHOLD_PX) && frames < MAX_SETTLE_FRAMES) {
        settleFrame = requestAnimationFrame(step);
      }
    };
    settleFrame = requestAnimationFrame(step);
  }

  $effect(() => {
    const currentlyAtEnd = atEnd;
    if (!currentlyAtEnd) return;

    const viewport = controller?.getViewportElement();
    if (viewport && !isDomAtEnd(viewport, BOTTOM_THRESHOLD_PX)) return;
    followBottom = true;
  });

  $effect(() => {
    const active = options.active?.() ?? true;
    const conversationId = options.conversationId();
    const ready = options.contentReady();
    const becameActive = active && !lastActive;
    lastActive = active;
    if (conversationId !== lastConversationId) {
      lastConversationId = conversationId;
      initialScrollDone = false;
      followBottom = true;
      cancelSettledScroll();
    }
    if (!active) {
      cancelSettledScroll();
      return;
    }
    // Wait for the opened conversation's transcript to populate (it loads after
    // the conversation id changes); scroll to the bottom exactly once it has.
    if (!options.conversationOpen() || !conversationId || !ready) return;
    if (!initialScrollDone) {
      initialScrollDone = true;
      void tick().then(scrollToEndWhenSettled);
      return;
    }
    if (becameActive && followBottom) {
      void tick().then(scrollToEndWhenSettled);
    }
  });

  $effect(() => {
    const el = composerWrapEl;
    const active = options.active?.() ?? true;
    if (!el || typeof ResizeObserver === "undefined") return;

    const updateComposerHeight = () => {
      composerHeight = active ? el.offsetHeight : 0;
    };
    updateComposerHeight();

    const observer = new ResizeObserver(updateComposerHeight);
    observer.observe(el);

    return () => observer.disconnect();
  });

  $effect(() => {
    const ctrl = controller;
    const el = ctrl?.getViewportElement();
    if (!el) return;

    let lastScrollTop = el.scrollTop;
    let scrollbarPointerActive = false;

    // Scroll events only report movement, not why it happened. Treat movement
    // as manual scroll-away only when it is paired with explicit user intent;
    // virtualizer/layout adjustments can otherwise look like upward scrolls.
    const handleScroll = () => {
      const nextScrollTop = el.scrollTop;
      const delta = nextScrollTop - lastScrollTop;
      lastScrollTop = nextScrollTop;

      if (programmaticScrollActive) return;

      const atEndByDom = isDomAtEnd(el, BOTTOM_THRESHOLD_PX);
      if (atEndByDom) {
        followBottom = true;
        return;
      }
      if (
        shouldDisableFollowForScroll({
          atEnd: atEndByDom,
          scrollDelta: delta,
          userScrollAwayIntent,
          scrollbarPointerActive,
          epsilon: SCROLL_DIRECTION_EPSILON_PX,
        })
      ) {
        disableFollowForManualScroll();
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      scrollbarPointerActive = isVerticalScrollbarPointer(event, el);
      if (scrollbarPointerActive) {
        markUserScrollIntent({
          disableFollowImmediately: true,
          viewport: el,
        });
      }
    };
    const handlePointerMove = () => {
      if (scrollbarPointerActive) {
        markUserScrollIntent({
          disableFollowImmediately: true,
          viewport: el,
        });
      }
    };
    const handlePointerEnd = () => {
      if (scrollbarPointerActive && isDomAtEnd(el, BOTTOM_THRESHOLD_PX)) {
        followBottom = true;
      }
      scrollbarPointerActive = false;
    };
    const handleWheel = (event: WheelEvent) => {
      const scrollAwayIntent = event.deltaY < 0;
      markUserScrollIntent({
        disableFollowImmediately: scrollAwayIntent,
        scrollAwayIntent,
        viewport: el,
      });
    };
    const handleTouchMove = () => {
      markUserScrollIntent({
        disableFollowImmediately: true,
        viewport: el,
      });
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!SCROLL_KEYS.has(event.key)) return;
      const scrollAwayIntent =
        SCROLL_AWAY_KEYS.has(event.key) ||
        (event.key === " " && event.shiftKey);
      markUserScrollIntent({
        disableFollowImmediately: scrollAwayIntent,
        scrollAwayIntent,
        viewport: el,
      });
    };

    el.addEventListener("scroll", handleScroll, { passive: true });
    el.addEventListener("wheel", handleWheel, { passive: true });
    el.addEventListener("touchmove", handleTouchMove, { passive: true });
    el.addEventListener("pointerdown", handlePointerDown, { passive: true });
    el.addEventListener("pointermove", handlePointerMove, { passive: true });
    el.addEventListener("pointerup", handlePointerEnd, { passive: true });
    el.addEventListener("pointerleave", handlePointerEnd, { passive: true });
    el.addEventListener("keydown", handleKeyDown);

    return () => {
      el.removeEventListener("scroll", handleScroll);
      el.removeEventListener("wheel", handleWheel);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("pointerdown", handlePointerDown);
      el.removeEventListener("pointermove", handlePointerMove);
      el.removeEventListener("pointerup", handlePointerEnd);
      el.removeEventListener("pointerleave", handlePointerEnd);
      el.removeEventListener("keydown", handleKeyDown);
    };
  });

  $effect(() => {
    return () => {
      cancelSettledScroll();
      clearUserScrollIntentTimer();
      clearProgrammaticScrollTimer();
      userScrollAwayIntent = false;
      programmaticScrollActive = false;
    };
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
    get followBottom() {
      return followBottom;
    },
    scrollToEnd,
    jumpToBottom,
  };
}
