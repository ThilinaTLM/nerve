/**
 * Pure decision logic for attention delivery (see
 * docs/proposals/conversation-composer-and-attention/notifications-ux.md).
 */

export type AttentionKind = "input" | "finished" | "failed" | "interrupted";
export type AttentionInputKind =
  | "approval"
  | "user_input"
  | "plan_review"
  | "configuration_blocked";
export type AttentionPresence = "watching" | "elsewhere" | "away";
export type AttentionSoundEvent =
  | "question"
  | "planReview"
  | "approval"
  | "completed"
  | "failed";
export type AttentionSurface = "none" | "toast" | "system";

export type AttentionDecision = {
  surface: AttentionSurface;
  sound: boolean;
};

/** No keyboard/pointer input for this long means the user is away. */
export const PRESENCE_IDLE_MS = 60_000;
export const SOUND_THROTTLE_MS = 4_000;
export const MUTE_DURATION_MS = 60 * 60 * 1000;

export function classifyPresence(input: {
  focused: boolean;
  lastInputAt: number;
  now: number;
  viewing: boolean;
}): AttentionPresence {
  if (!input.focused || input.now - input.lastInputAt >= PRESENCE_IDLE_MS) {
    return "away";
  }
  return input.viewing ? "watching" : "elsewhere";
}

export function attentionSoundEvent(event: {
  kind: AttentionKind;
  inputKind?: AttentionInputKind;
}): AttentionSoundEvent {
  if (event.kind === "finished") return "completed";
  if (event.kind !== "input") return "failed";
  switch (event.inputKind) {
    case "user_input":
      return "question";
    case "plan_review":
      return "planReview";
    default:
      return "approval";
  }
}

export function decideDelivery(
  presence: AttentionPresence,
  muted: boolean,
): AttentionDecision {
  if (muted || presence === "watching")
    return { surface: "none", sound: false };
  return {
    surface: presence === "away" ? "system" : "toast",
    sound: true,
  };
}

/** Higher is more urgent: input > failure > finished. */
export function attentionUrgency(kind: AttentionKind): number {
  if (kind === "input") return 2;
  return kind === "finished" ? 0 : 1;
}

/** The most urgent event among coinciding ones (first wins ties). */
export function mostUrgent<T extends { kind: AttentionKind }>(
  events: readonly T[],
): T | undefined {
  let best: T | undefined;
  for (const event of events) {
    if (!best || attentionUrgency(event.kind) > attentionUrgency(best.kind)) {
      best = event;
    }
  }
  return best;
}

/** Allows at most one sound per interval. */
export function createSoundThrottle(intervalMs = SOUND_THROTTLE_MS): {
  tryAcquire(now: number): boolean;
} {
  let last: number | undefined;
  return {
    tryAcquire(now) {
      if (last !== undefined && now - last < intervalMs) return false;
      last = now;
      return true;
    },
  };
}
