import type { ConversationMotionProfile } from "../transcript/conversation-motion-budget";

export const LIFECYCLE_MOTION = {
  standard: {
    durationMs: 180,
    easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
    settleOffsetPx: 2,
    fromOpacity: 0.88,
  },
  compact: {
    durationMs: 120,
    easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
    settleOffsetPx: 0,
    fromOpacity: 0.9,
  },
  minimal: {
    durationMs: 90,
    easing: "ease-out",
    settleOffsetPx: 0,
    fromOpacity: 0.92,
  },
} as const;

export type LifecycleMotionPlan = {
  animateContent: boolean;
  durationMs: number;
  easing: string;
  settleOffsetPx: number;
  fromOpacity: number;
};

export function resolveLifecycleMotionPlan(input: {
  profile: ConversationMotionProfile;
  reducedMotion: boolean;
  visible: boolean;
}): LifecycleMotionPlan {
  const spec = LIFECYCLE_MOTION[input.profile];
  const disabled = input.reducedMotion || !input.visible;
  return {
    animateContent: !disabled,
    durationMs: disabled ? 0 : spec.durationMs,
    easing: spec.easing,
    settleOffsetPx: spec.settleOffsetPx,
    fromOpacity: spec.fromOpacity,
  };
}

export type LifecycleMotionController = {
  transition(reducedMotion: boolean, profile: ConversationMotionProfile): void;
  snap(): void;
  destroy(): void;
};

/**
 * Owns the interruptible content settle animation at lifecycle milestones.
 * Height is not animated here: the transcript row's height follower is the
 * single owner of height motion, so two animators never compete.
 */
export function createLifecycleMotion(
  content: HTMLElement,
): LifecycleMotionController {
  let contentAnimation: Animation | undefined;
  let destroyed = false;

  function cancelAnimation(): void {
    contentAnimation?.cancel();
    contentAnimation = undefined;
    content.style.removeProperty("will-change");
  }

  function transition(
    reducedMotion: boolean,
    profile: ConversationMotionProfile,
  ): void {
    if (destroyed) return;
    const plan = resolveLifecycleMotionPlan({
      profile,
      reducedMotion,
      visible: content.getClientRects().length > 0,
    });
    cancelAnimation();
    if (!plan.animateContent) return;

    content.style.willChange = "transform, opacity";
    const animation = content.animate(
      [
        {
          opacity: plan.fromOpacity,
          transform: `translateY(${plan.settleOffsetPx}px)`,
        },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: plan.durationMs, easing: plan.easing },
    );
    contentAnimation = animation;
    void animation.finished
      .then(() => {
        if (contentAnimation !== animation) return;
        contentAnimation = undefined;
        content.style.removeProperty("will-change");
      })
      .catch(() => undefined);
  }

  return {
    transition,
    snap() {
      if (!destroyed) cancelAnimation();
    },
    destroy() {
      if (destroyed) return;
      cancelAnimation();
      destroyed = true;
    },
  };
}
