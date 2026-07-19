import type { ConversationMotionProfile } from "../../../components/transcript/conversation-motion-budget";

export const TOOL_LIFECYCLE_MOTION = {
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

export type ToolLifecycleMotionPlan = {
  animateHeight: boolean;
  animateContent: boolean;
  durationMs: number;
  easing: string;
  settleOffsetPx: number;
  fromOpacity: number;
};

export function resolveToolLifecycleMotionPlan(input: {
  profile: ConversationMotionProfile;
  fromHeight: number;
  targetHeight: number;
  reducedMotion: boolean;
  visible: boolean;
}): ToolLifecycleMotionPlan {
  const spec = TOOL_LIFECYCLE_MOTION[input.profile];
  const disabled = input.reducedMotion || !input.visible;
  return {
    animateHeight:
      !disabled &&
      input.profile !== "minimal" &&
      Math.abs(input.fromHeight - input.targetHeight) > 0.5,
    animateContent: !disabled && input.targetHeight > 0,
    durationMs: disabled ? 0 : spec.durationMs,
    easing: spec.easing,
    settleOffsetPx: spec.settleOffsetPx,
    fromOpacity: spec.fromOpacity,
  };
}

export type ToolLifecycleMotionController = {
  transition(
    fromHeight: number,
    reducedMotion: boolean,
    profile: ConversationMotionProfile,
  ): void;
  snap(): void;
  destroy(): void;
};

/**
 * Owns interruptible full-card geometry and content animations. A superseding
 * transition begins from geometry captured by the caller, cancels prior
 * effects, and always leaves the card at intrinsic height.
 */
export function createToolLifecycleMotion(
  element: HTMLElement,
  content: HTMLElement,
): ToolLifecycleMotionController {
  let heightAnimation: Animation | undefined;
  let contentAnimation: Animation | undefined;
  let destroyed = false;

  function clearHeightStyles(): void {
    element.style.removeProperty("overflow");
    element.style.removeProperty("will-change");
  }

  function clearContentStyles(): void {
    content.style.removeProperty("will-change");
  }

  function cancelAnimations(): void {
    heightAnimation?.cancel();
    contentAnimation?.cancel();
    heightAnimation = undefined;
    contentAnimation = undefined;
    clearHeightStyles();
    clearContentStyles();
  }

  function snap(): void {
    if (destroyed) return;
    cancelAnimations();
  }

  function transition(
    fromHeight: number,
    reducedMotion: boolean,
    profile: ConversationMotionProfile,
  ): void {
    if (destroyed) return;

    const targetHeight = content.getBoundingClientRect().height;
    const visible = element.getClientRects().length > 0;
    const plan = resolveToolLifecycleMotionPlan({
      profile,
      fromHeight,
      targetHeight,
      reducedMotion,
      visible,
    });
    cancelAnimations();

    if (plan.animateHeight) {
      element.style.overflow = "hidden";
      element.style.willChange = "height";
      const animation = element.animate(
        [
          { height: `${Math.max(0, fromHeight)}px` },
          { height: `${Math.max(0, targetHeight)}px` },
        ],
        { duration: plan.durationMs, easing: plan.easing },
      );
      heightAnimation = animation;
      void animation.finished
        .then(() => {
          if (heightAnimation !== animation) return;
          heightAnimation = undefined;
          clearHeightStyles();
        })
        .catch(() => undefined);
    }

    if (plan.animateContent) {
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
          clearContentStyles();
        })
        .catch(() => undefined);
    }
  }

  return {
    transition,
    snap,
    destroy() {
      if (destroyed) return;
      cancelAnimations();
      destroyed = true;
    },
  };
}
