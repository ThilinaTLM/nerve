/** Central motion specification for structural tool-card changes. */
export const TOOL_ACTIVITY_MOTION = {
  durationMs: 180,
  easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
  settleOffsetPx: 2,
} as const;

export type ToolActivityMotionController = {
  transition(fromHeight: number, reducedMotion: boolean): void;
  snap(): void;
  destroy(): void;
};

/**
 * Owns the two interruptible WAAPI animations for a persistent activity
 * region. A superseding transition starts from geometry captured by the
 * caller, cancels the old animations, and leaves the node at intrinsic height.
 */
export function createToolActivityMotion(
  element: HTMLElement,
  content: HTMLElement,
): ToolActivityMotionController {
  let heightAnimation: Animation | undefined;
  let contentAnimation: Animation | undefined;
  let destroyed = false;

  function clearHeightStyles(): void {
    element.style.removeProperty("overflow");
    element.style.removeProperty("will-change");
  }

  function cancelAnimations(): void {
    heightAnimation?.cancel();
    contentAnimation?.cancel();
    heightAnimation = undefined;
    contentAnimation = undefined;
    clearHeightStyles();
  }

  function snap(): void {
    if (destroyed) return;
    cancelAnimations();
  }

  function transition(fromHeight: number, reducedMotion: boolean): void {
    if (destroyed) return;

    // The inner node remains intrinsically sized while the outer node's
    // animated height is composited, so it is the latest natural target.
    const targetHeight = content.getBoundingClientRect().height;
    const visible = element.getClientRects().length > 0;
    cancelAnimations();
    if (reducedMotion || !visible) return;

    if (Math.abs(fromHeight - targetHeight) > 0.5) {
      element.style.overflow = "hidden";
      element.style.willChange = "height";
      const animation = element.animate(
        [
          { height: `${Math.max(0, fromHeight)}px` },
          { height: `${Math.max(0, targetHeight)}px` },
        ],
        {
          duration: TOOL_ACTIVITY_MOTION.durationMs,
          easing: TOOL_ACTIVITY_MOTION.easing,
        },
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

    if (targetHeight > 0) {
      const animation = content.animate(
        [
          {
            opacity: 0.82,
            transform: `translateY(${TOOL_ACTIVITY_MOTION.settleOffsetPx}px)`,
          },
          { opacity: 1, transform: "translateY(0)" },
        ],
        {
          duration: TOOL_ACTIVITY_MOTION.durationMs,
          easing: TOOL_ACTIVITY_MOTION.easing,
        },
      );
      contentAnimation = animation;
      void animation.finished
        .then(() => {
          if (contentAnimation === animation) contentAnimation = undefined;
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
