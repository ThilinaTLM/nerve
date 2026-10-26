export type TriggerWidthAnimation = {
  /** Call right before the DOM changes: records the width the user sees now. */
  capture(): void;
  /** Call right after the DOM changed: animates from the captured width. */
  play(): void;
  destroy(): void;
};

/** Animate the actual trigger, not a clone/wrapper, so focus and the popover
 * anchor keep following its rendered box. Width is intrinsic again at rest.
 *
 * Animation is explicit (`capture` → DOM change → `play`) rather than inferred
 * from DOM mutations: hydration, font swaps and layout-driven resizes never
 * animate, and the start width is always the one rendered at capture time. */
export function createTriggerWidthAnimation(
  node: HTMLElement,
): TriggerWidthAnimation {
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const width = () => getComputedStyle(node).width;
  let from: string | undefined;
  let animation: Animation | undefined;

  function cancel() {
    animation?.cancel();
    animation = undefined;
  }

  motion.addEventListener("change", cancel);

  return {
    capture() {
      // An in-flight animation reports its animated width: interruptions
      // continue from what is on screen.
      from = width();
    },
    play() {
      const start = from;
      from = undefined;
      // Cancelling releases the width effect, so `to` is the natural size
      // including flex shrink, truncation and container-query visibility.
      cancel();
      const to = width();
      if (
        start === undefined ||
        motion.matches ||
        start === to ||
        !node.getClientRects().length
      )
        return;
      const next = node.animate([{ width: start }, { width: to }], {
        duration: 200,
        easing: "cubic-bezier(0, 0, 0.2, 1)",
      });
      animation = next;
      next.onfinish = () => {
        // No fill or persistent inline width: responsive flex truncation stays
        // authoritative after the transition.
        if (animation === next) animation = undefined;
      };
    },
    destroy() {
      motion.removeEventListener("change", cancel);
      cancel();
    },
  };
}
