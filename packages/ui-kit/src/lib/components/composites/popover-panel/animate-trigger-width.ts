/** Animate the actual trigger, not a clone/wrapper, so focus and the popover
 * anchor keep following its rendered box. Width is intrinsic again at rest. */
export function animateTriggerWidth(node: HTMLElement): () => void {
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const width = () => getComputedStyle(node).width;
  let previousWidth = width();
  let animation: Animation | undefined;

  function settle() {
    animation?.cancel();
    animation = undefined;
    previousWidth = width();
  }

  function measure() {
    // Read the in-flight width before cancelling; cancelling releases the width
    // effect so this measurement includes natural text size, flex shrink,
    // truncation and container-query visibility, rather than the animated box.
    const from = animation ? width() : previousWidth;
    animation?.cancel();
    animation = undefined;
    const to = width();
    previousWidth = to;
    if (motion.matches || from === to || !node.getClientRects().length) return;

    const next = node.animate([{ width: from }, { width: to }], {
      duration: 200,
      easing: "cubic-bezier(0, 0, 0.2, 1)",
    });
    animation = next;
    next.onfinish = () => {
      if (animation !== next) return;
      // No fill or persistent inline width: responsive flex truncation stays
      // authoritative after the transition as well as during measurement.
      animation = undefined;
      previousWidth = width();
    };
  }

  // Mutation delivery is before paint. WAAPI does not write style attributes,
  // so neither animation frames nor our measurements feed this observer.
  const mutations = new MutationObserver(measure);
  mutations.observe(node, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["class", "style", "hidden"],
  });

  // Responsive layout changes should immediately regain intrinsic sizing.
  // Observe the container, never the animated trigger or its shrinking text.
  const parent = node.parentElement;
  let parentWidth = parent?.getBoundingClientRect().width;
  const resize = new ResizeObserver(() => {
    const nextWidth = parent?.getBoundingClientRect().width;
    if (nextWidth === parentWidth) return;
    parentWidth = nextWidth;
    settle();
  });
  if (parent) resize.observe(parent);
  motion.addEventListener("change", settle);
  document.fonts?.addEventListener("loadingdone", measure);

  return () => {
    mutations.disconnect();
    resize.disconnect();
    motion.removeEventListener("change", settle);
    document.fonts?.removeEventListener("loadingdone", measure);
    animation?.cancel();
  };
}
