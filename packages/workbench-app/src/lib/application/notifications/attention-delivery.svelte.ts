import {
  attentionSoundEvent,
  classifyPresence,
  createSoundThrottle,
  decideDelivery,
  mostUrgent,
  MUTE_DURATION_MS,
  type AttentionInputKind,
  type AttentionKind,
  type AttentionPresence,
} from "./attention-policy";
import {
  notificationState,
  notifyNative,
  notifyToast,
  requestBrowserNotificationPermission,
} from "./notify.svelte";
import { playNotificationSound } from "./state/notification-sounds";

export type AttentionEvent = {
  kind: AttentionKind;
  inputKind?: AttentionInputKind;
  conversationId: string;
  title: string;
  body: string;
  /** Set when a sub-agent (not the lead) raised the event; already part of `title`. */
  subAgentName?: string;
  /** Navigates to the conversation (or sub-agent) behind the event. */
  open(): void;
};

type DeliveryOptions = {
  /** Test notifications ignore presence and the sound throttle. */
  test?: boolean;
};

/** Events arriving within this window compete for a single sound. */
const SOUND_COALESCE_MS = 100;

let isViewing: (conversationId: string) => boolean = () => false;
let lastInputAt = Date.now();
let installed = false;
const throttle = createSoundThrottle();
let pendingSounds: AttentionEvent[] = [];
let soundTimer: ReturnType<typeof setTimeout> | undefined;

const muteState = $state<{ until: number | undefined }>({ until: undefined });
let muteTimer: ReturnType<typeof setTimeout> | undefined;

/** Session-local mute for sound, toast and system pop-ups in this window. */
export const attentionMute = {
  get muted(): boolean {
    return muteState.until !== undefined;
  },
  /** Epoch ms when the mute ends, if muted. */
  get until(): number | undefined {
    return muteState.until;
  },
  mute(durationMs = MUTE_DURATION_MS): void {
    clearTimeout(muteTimer);
    muteState.until = Date.now() + durationMs;
    muteTimer = setTimeout(() => attentionMute.unmute(), durationMs);
  },
  unmute(): void {
    clearTimeout(muteTimer);
    muteState.until = undefined;
  },
};

/**
 * Installs the presence tracker (once) and sets which conversation is in
 * front. Returns a cleanup function.
 */
export function configureAttentionDelivery(options: {
  isViewing: (conversationId: string) => boolean;
}): () => void {
  isViewing = options.isViewing;
  const uninstall = installPresenceTracker();
  return () => {
    isViewing = () => false;
    uninstall();
  };
}

function installPresenceTracker(): () => void {
  if (installed || typeof window === "undefined") return () => undefined;
  installed = true;
  lastInputAt = Date.now();
  const touch = () => {
    lastInputAt = Date.now();
  };
  const events = ["keydown", "pointerdown", "pointermove", "wheel"] as const;
  for (const name of events) {
    window.addEventListener(name, touch, { capture: true, passive: true });
  }
  window.addEventListener("focus", touch);
  return () => {
    for (const name of events) window.removeEventListener(name, touch, true);
    window.removeEventListener("focus", touch);
    installed = false;
  };
}

/** Where the user is relative to a conversation right now. */
export function attentionPresence(conversationId: string): AttentionPresence {
  const focused =
    typeof document !== "undefined" &&
    document.visibilityState === "visible" &&
    document.hasFocus();
  return classifyPresence({
    focused,
    lastInputAt,
    now: Date.now(),
    viewing: isViewing(conversationId),
  });
}

export function deliverAttention(
  event: AttentionEvent,
  options: DeliveryOptions = {},
): void {
  installPresenceTracker();
  const presence = options.test
    ? "away"
    : attentionPresence(event.conversationId);
  const decision = decideDelivery(presence, attentionMute.muted);

  if (decision.sound) queueSound(event, options.test === true);

  if (decision.surface === "none") return;
  const { title } = event;
  const kind = event.kind === "finished" ? "success" : "error";
  if (decision.surface === "toast") {
    notifyToast(title, {
      description: event.body,
      id: event.conversationId,
      kind: event.kind === "input" ? "message" : kind,
      action: { label: "Open", onClick: event.open },
    });
  } else {
    notifyNative(
      {
        title,
        body: event.body,
        urgency: event.kind === "finished" ? "normal" : "attention",
      },
      {
        tag: event.conversationId,
        onOpen: event.open,
        kind: event.kind === "input" ? "message" : kind,
      },
    );
  }
}

function queueSound(event: AttentionEvent, immediate: boolean): void {
  if (immediate) {
    playFor(event);
    return;
  }
  pendingSounds.push(event);
  soundTimer ??= setTimeout(flushSounds, SOUND_COALESCE_MS);
}

function flushSounds(): void {
  const winner = mostUrgent(pendingSounds);
  pendingSounds = [];
  soundTimer = undefined;
  if (winner && throttle.tryAcquire(Date.now())) playFor(winner);
}

function playFor(event: AttentionEvent): void {
  if (!notificationState.soundsEnabled) return;
  const tone = notificationState.eventSounds[attentionSoundEvent(event)];
  if (tone !== "none") playNotificationSound(tone);
}

/** Sends a sample notification through the real delivery path. */
export async function sendTestNotification(): Promise<void> {
  if (notificationState.permission === "default") {
    await requestBrowserNotificationPermission();
  }
  deliverAttention(
    {
      kind: "finished",
      conversationId: "nerve-test-notification",
      title: "Test notification",
      body: "Notifications are working.",
      open: () => undefined,
    },
    { test: true },
  );
}
