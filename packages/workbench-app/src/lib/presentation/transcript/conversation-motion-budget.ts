export type ConversationMotionProfile = "standard" | "compact" | "minimal";

export type ConversationMotionAllocation = {
  profile: ConversationMotionProfile;
  delaysMs: readonly number[];
};

export const CONVERSATION_MOTION_POLICY = {
  burstWindowMs: 160,
  cooldownMs: 240,
  compactThreshold: 4,
  minimalThreshold: 9,
  compactDelayStepMs: 12,
  compactDelayCapMs: 60,
} as const;

const PROFILE_SEVERITY: Record<ConversationMotionProfile, number> = {
  standard: 0,
  compact: 1,
  minimal: 2,
};

function denserProfile(
  current: ConversationMotionProfile,
  candidate: ConversationMotionProfile,
): ConversationMotionProfile {
  return PROFILE_SEVERITY[candidate] > PROFILE_SEVERITY[current]
    ? candidate
    : current;
}

function profileForCount(count: number): ConversationMotionProfile {
  if (count >= CONVERSATION_MOTION_POLICY.minimalThreshold) return "minimal";
  if (count >= CONVERSATION_MOTION_POLICY.compactThreshold) return "compact";
  return "standard";
}

/**
 * Per-conversation rolling motion budget. It does not drive state or timers;
 * callers claim a profile only when a visual transition actually starts.
 */
export class ConversationMotionBudget {
  private readonly eventTimes: number[] = [];
  private lastEventAt: number | undefined;
  private activeProfile: ConversationMotionProfile = "standard";

  constructor(private readonly now: () => number = () => performance.now()) {}

  allocateBatch(count: number): ConversationMotionAllocation {
    if (count <= 0) return { profile: "standard", delaysMs: [] };
    const time = this.now();
    this.prepareWindow(time);
    for (let index = 0; index < count; index += 1) {
      this.eventTimes.push(time);
    }
    this.lastEventAt = time;
    this.activeProfile = denserProfile(
      this.activeProfile,
      profileForCount(this.eventTimes.length),
    );

    const delaysMs = Array.from({ length: count }, (_, index) =>
      this.activeProfile === "compact"
        ? Math.min(
            index * CONVERSATION_MOTION_POLICY.compactDelayStepMs,
            CONVERSATION_MOTION_POLICY.compactDelayCapMs,
          )
        : 0,
    );
    return { profile: this.activeProfile, delaysMs };
  }

  claim(): ConversationMotionProfile {
    return this.allocateBatch(1).profile;
  }

  reset(): void {
    this.eventTimes.length = 0;
    this.lastEventAt = undefined;
    this.activeProfile = "standard";
  }

  private prepareWindow(time: number): void {
    if (
      this.lastEventAt !== undefined &&
      time - this.lastEventAt >= CONVERSATION_MOTION_POLICY.cooldownMs
    ) {
      this.reset();
    }
    const cutoff = time - CONVERSATION_MOTION_POLICY.burstWindowMs;
    while (this.eventTimes.length > 0 && this.eventTimes[0]! < cutoff) {
      this.eventTimes.shift();
    }
  }
}
