import type {
  AttentionInputKind,
  AttentionKind,
} from "@nervekit/contracts/core";

/**
 * Pure decision logic for attention delivery (see
 * docs/architecture/conversation-state-and-attention.md). Which edges deserve
 * attention is shared with the daemon in `@nervekit/contracts/core`.
 */

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
