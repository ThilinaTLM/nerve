import { tick } from "svelte";

type ScrollOptions = {
  force?: boolean;
  smooth?: boolean;
};

type ConversationScrollControllerOptions = {
  conversationOpen: () => boolean;
  conversationId: () => string | undefined;
  scrollSignature: () => string;
  queuedPromptSignature: () => string;
  sending: () => boolean;
  streamingTextLength: () => number;
};

const BOTTOM_THRESHOLD_PX = 24;
const USER_SCROLL_INTENT_TIMEOUT_MS = 350;
const PROGRAMMATIC_SCROLL_GUARD_MS = 120;

function distanceFromBottom(el: HTMLElement): number {
  return Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight);
}

function prefersReducedMotion(): boolean {
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
  );
}

export function createConversationScrollController(
  options: ConversationScrollControllerOptions,
) {
  let transcriptEl = $state<HTMLDivElement>();
  let transcriptContentEl = $state<HTMLDivElement>();
  let composerWrapEl = $state<HTMLDivElement>();
  let bottomEl = $state<HTMLDivElement>();
  let followBottom = $state(true);
  let composerHeight = $state(0);
  let scrollFrame: number | undefined;
  let lastConversationId: string | undefined;
  let userScrollIntent = false;
  let userScrollIntentStartTop: number | undefined;
  let userScrollIntentTimer: ReturnType<typeof setTimeout> | undefined;
  let programmaticScrollActive = false;
  let programmaticScrollTimer: ReturnType<typeof setTimeout> | undefined;
  let pointerScrollActive = false;

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

  function markUserScrollIntent() {
    programmaticScrollActive = false;
    clearProgrammaticScrollTimer();
    cancelScheduledBottomScroll();
    userScrollIntent = true;
    userScrollIntentStartTop = transcriptEl?.scrollTop;
    clearUserScrollIntentTimer();
    userScrollIntentTimer = setTimeout(() => {
      userScrollIntent = false;
      userScrollIntentStartTop = undefined;
      userScrollIntentTimer = undefined;
    }, USER_SCROLL_INTENT_TIMEOUT_MS);
  }

  function handleTranscriptScroll() {
    if (!transcriptEl || programmaticScrollActive) return;

    const distance = distanceFromBottom(transcriptEl);
    if (distance <= BOTTOM_THRESHOLD_PX) {
      followBottom = true;
      return;
    }

    followBottom = false;
  }

  function cancelScheduledBottomScroll() {
    if (scrollFrame === undefined) return;
    cancelAnimationFrame(scrollFrame);
    scrollFrame = undefined;
  }

  async function scrollBottomNow(scrollOptions: ScrollOptions = {}) {
    const force = scrollOptions.force === true;
    if (!transcriptEl) return;
    if (!force && !followBottom) return;
    if (force) followBottom = true;

    await tick();

    if (!transcriptEl) return;
    if (!force && !followBottom) return;
    const userScrolledUp =
      userScrollIntentStartTop !== undefined &&
      transcriptEl.scrollTop < userScrollIntentStartTop - 1;
    if (
      !force &&
      userScrollIntent &&
      userScrolledUp &&
      distanceFromBottom(transcriptEl) > BOTTOM_THRESHOLD_PX
    ) {
      return;
    }

    const behavior: ScrollBehavior =
      scrollOptions.smooth && !prefersReducedMotion() ? "smooth" : "auto";

    markProgrammaticScroll();

    if (bottomEl) {
      bottomEl.scrollIntoView({ block: "end", behavior });
    }

    transcriptEl.scrollTo({ top: transcriptEl.scrollHeight, behavior });
  }

  function scheduleBottomScroll(scrollOptions: ScrollOptions = {}) {
    cancelScheduledBottomScroll();
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = undefined;
      void scrollBottomNow(scrollOptions);
    });
  }

  $effect(() => {
    const _signature = options.scrollSignature();
    const _queuedPromptSignature = options.queuedPromptSignature();
    const _sending = options.sending();
    const _streamingTextLength = options.streamingTextLength();
    if (options.conversationOpen() && followBottom) {
      scheduleBottomScroll({ smooth: false });
    }
  });

  $effect(() => {
    const conversationId = options.conversationId();
    if (conversationId === lastConversationId) return;
    lastConversationId = conversationId;
    if (conversationId) scheduleBottomScroll({ force: true, smooth: false });
  });

  $effect(() => {
    const el = transcriptContentEl;
    if (!el || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      scheduleBottomScroll({ smooth: false });
    });
    observer.observe(el);

    return () => observer.disconnect();
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

  $effect(() => {
    const el = transcriptEl;
    if (!el) return;

    const handlePointerDown = () => {
      pointerScrollActive = true;
    };
    const handlePointerMove = () => {
      if (pointerScrollActive) markUserScrollIntent();
    };
    const handlePointerEnd = () => {
      pointerScrollActive = false;
    };

    el.addEventListener("wheel", markUserScrollIntent, { passive: true });
    el.addEventListener("touchmove", markUserScrollIntent, { passive: true });
    el.addEventListener("pointerdown", handlePointerDown, { passive: true });
    el.addEventListener("pointermove", handlePointerMove, { passive: true });
    el.addEventListener("pointerup", handlePointerEnd, { passive: true });
    el.addEventListener("pointerleave", handlePointerEnd, { passive: true });

    return () => {
      el.removeEventListener("wheel", markUserScrollIntent);
      el.removeEventListener("touchmove", markUserScrollIntent);
      el.removeEventListener("pointerdown", handlePointerDown);
      el.removeEventListener("pointermove", handlePointerMove);
      el.removeEventListener("pointerup", handlePointerEnd);
      el.removeEventListener("pointerleave", handlePointerEnd);
    };
  });

  $effect(() => {
    return () => {
      cancelScheduledBottomScroll();
      clearUserScrollIntentTimer();
      userScrollIntentStartTop = undefined;
      programmaticScrollActive = false;
      clearProgrammaticScrollTimer();
    };
  });

  return {
    get transcriptEl() {
      return transcriptEl;
    },
    set transcriptEl(value: HTMLDivElement | undefined) {
      transcriptEl = value;
    },
    get transcriptContentEl() {
      return transcriptContentEl;
    },
    set transcriptContentEl(value: HTMLDivElement | undefined) {
      transcriptContentEl = value;
    },
    get composerWrapEl() {
      return composerWrapEl;
    },
    set composerWrapEl(value: HTMLDivElement | undefined) {
      composerWrapEl = value;
    },
    get bottomEl() {
      return bottomEl;
    },
    set bottomEl(value: HTMLDivElement | undefined) {
      bottomEl = value;
    },
    get followBottom() {
      return followBottom;
    },
    get composerHeight() {
      return composerHeight;
    },
    handleTranscriptScroll,
    scheduleBottomScroll,
  };
}
