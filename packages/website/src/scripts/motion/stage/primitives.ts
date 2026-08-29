/* The four motion primitives every stage is built from.
 *
 * One idea runs through all of them: a signal propagating through a nervous
 * system. Things either *arrive* (P1 masked lines, P2 depth settle) or they
 * *conduct* (P3 an impulse travelling a real path, P4 scrubbed parallax).
 * Keeping the vocabulary this small is what makes ten sections read as one
 * page rather than ten separate demos.
 */

import {
  allowEntrance,
  gsap,
  jitter,
  MotionPathPlugin,
  playWhileVisible,
  qa,
  ScrollTrigger,
  SplitText,
} from "./runtime";

/* P1 — masked line reveal --------------------------------------------------
 *
 * Lines rise out of a clipping box. The split is created at trigger time so it
 * measures the final layout, and reverted the moment the tween finishes so the
 * heading returns to its authored markup: text selection, copy, and screen
 * reader output are all untouched a few hundred milliseconds later. */
export function revealLines(
  target: Element | null,
  options: { delay?: number; stagger?: number; start?: string } = {},
): void {
  if (!target) return;

  const { delay = 0, stagger = 0.075, start = "top 88%" } = options;

  const run = (): void => {
    arm(target);
    if (!allowEntrance) return;

    const split = new SplitText(target, {
      type: "lines",
      linesClass: "split-line",
      mask: "lines",
    });

    gsap.from(split.lines, {
      yPercent: 118,
      opacity: 0,
      duration: 0.9,
      delay,
      stagger,
      ease: "signal",
      onComplete: () => split.revert(),
    });
  };

  /* Anything already on screen when the stage attaches must never wait for a
   * scroll trigger: it would sit readable, then vanish and re-enter on the
   * first scroll. Play it now (or simply arm it if the entrance window has
   * passed) and reserve the trigger for content still below the fold. */
  if (inViewport(target)) {
    run();
    return;
  }

  ScrollTrigger.create({ trigger: target, start, once: true, onEnter: run });
}

/* Slightly generous on purpose: an element clipped by the fold still counts as
 * seen, because a later scroll trigger would visibly re-run it. */
function inViewport(element: Element): boolean {
  return element.getBoundingClientRect().top < window.innerHeight * 0.98;
}

/* Hands an element over from the CSS pre-hidden state to GSAP, in the same
 * frame the tween starts, so there is never a gap where it is invisible with
 * nothing animating it. `motion.css` hides `[data-reveal]` blocks only while
 * `html[data-motion-ready]` is set and `.is-revealed` is absent. */
function arm(element: Element): void {
  element.classList.add("is-revealed");
  element.closest("[data-reveal]")?.classList.add("is-revealed");
}

/* P2 — depth settle --------------------------------------------------------
 *
 * The general purpose arrival. Elements rise a short distance with a trace of
 * perspective, as if settling onto the page rather than sliding across it.
 * Batched so a grid of cards enters as one wave instead of N independent
 * observers firing in scroll order. */
export function settleIn(
  targets: Element[],
  options: {
    stagger?: number;
    y?: number;
    start?: string;
    rotate?: number;
  } = {},
): void {
  const elements = targets.filter(Boolean);
  if (!elements.length) return;

  const { stagger = 0.06, y = 26, start = "top 88%", rotate = 3 } = options;

  /* Split by fold position at attach time. Elements already on screen are
   * handled immediately — animated during the entrance window, plainly armed
   * after it — so a scroll trigger can never yank readable content back to
   * opacity zero. Only unseen elements get the scroll choreography. */
  const seen = elements.filter((element) => inViewport(element));
  const unseen = elements.filter((element) => !inViewport(element));

  const enter = (batch: Element[]): void => {
    for (const element of batch) arm(element);
    if (!allowEntrance) return;

    gsap.from(batch, {
      /* `Reveal` may ask for a direction; the default is a short rise. */
      x: (_: number, target: Element) => {
        const variant = target.getAttribute("data-reveal");
        if (variant === "left") return -22;
        if (variant === "right") return 22;
        return 0;
      },
      y: (_: number, target: Element) =>
        target.getAttribute("data-reveal") === "left" ||
        target.getAttribute("data-reveal") === "right"
          ? 0
          : y,
      scale: 0.985,
      opacity: 0,
      rotateX: rotate,
      transformOrigin: "50% 100%",
      duration: 0.7,
      stagger,
      ease: "settle",
      clearProps: "transform,transformOrigin,opacity",
    });
  };

  if (seen.length) enter(seen);

  if (unseen.length) {
    ScrollTrigger.batch(unseen, {
      start,
      once: true,
      onEnter: (batch) => enter(batch),
    });
  }
}

/* P3 — conduction ----------------------------------------------------------
 *
 * A path draws itself, then carries an impulse. This is the primitive that
 * makes the diagrams argue for the product: nothing lights up on its own, it
 * lights up because something reached it. */
export interface ConductOptions {
  /* Seconds for one traversal. */
  duration?: number;
  /* Pause between traversals, jittered per index so parallel branches desync. */
  gap?: number;
  index?: number;
  /* Called with 0..1 progress of the impulse, for lighting what it passes. */
  onProgress?: (progress: number) => void;
  draw?: boolean;
}

export function conduct(
  path: SVGPathElement,
  options: ConductOptions = {},
): gsap.core.Timeline | undefined {
  const svg = path.ownerSVGElement;
  if (!svg) return undefined;

  const {
    duration = 2.4,
    gap = 1.2,
    index = 0,
    onProgress,
    draw = true,
  } = options;

  if (draw) drawPath(path, index);

  const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  dot.setAttribute("r", "3");
  dot.setAttribute("class", "impulse-dot");
  dot.setAttribute("aria-hidden", "true");
  path.parentNode?.appendChild(dot);

  const timeline = gsap.timeline({
    repeat: -1,
    repeatDelay: gap + jitter(index, 1.4),
    paused: true,
    delay: jitter(index + 7, 0.9),
  });

  timeline
    .set(dot, { opacity: 0 })
    .to(dot, { opacity: 1, duration: 0.18 }, 0)
    .to(
      dot,
      {
        motionPath: { path, align: path, alignOrigin: [0.5, 0.5] },
        duration,
        ease: "none",
        onUpdate: onProgress
          ? function onTick(this: gsap.core.Tween) {
              onProgress(this.progress());
            }
          : undefined,
      },
      0,
    )
    .to(dot, { opacity: 0, duration: 0.22 }, duration - 0.1);

  playWhileVisible(svg, timeline);
  return timeline;
}

/* A bright segment travelling along a path, drawn with the path's own stroke.
 *
 * Used where `conduct` cannot be: an SVG with `preserveAspectRatio="none"`
 * scales non-uniformly, so a circle following the path would render as a
 * stretched ellipse, while a dash on a `non-scaling-stroke` path stays exact.
 */
export function travelDash(
  path: SVGPathElement,
  options: {
    duration?: number;
    gap?: number;
    segment?: number;
    onProgress?: (progress: number) => void;
  } = {},
): void {
  const { duration = 3.2, gap = 1, segment = 70, onProgress } = options;
  const length = path.getTotalLength();
  if (!Number.isFinite(length) || length === 0) return;

  const timeline = gsap.timeline({
    repeat: -1,
    repeatDelay: gap,
    paused: true,
  });
  timeline.fromTo(
    path,
    { strokeDasharray: `${segment} ${length}`, strokeDashoffset: segment },
    {
      strokeDashoffset: -length,
      duration,
      ease: "none",
      onUpdate: onProgress
        ? function onTick(this: gsap.core.Tween) {
            onProgress(this.progress());
          }
        : undefined,
    },
  );

  playWhileVisible(path.ownerSVGElement ?? path, timeline);
}

/* Draws a path by animating stroke-dashoffset. The authored state is fully
 * drawn, so this only ever runs as an enhancement. */
export function drawPath(path: SVGPathElement, index = 0): void {
  if (!allowEntrance && !path.isConnected) return;

  const length = path.getTotalLength();
  if (!Number.isFinite(length) || length === 0) return;

  gsap.fromTo(
    path,
    { strokeDasharray: length, strokeDashoffset: length },
    {
      strokeDashoffset: 0,
      duration: 0.9,
      delay: index * 0.07,
      ease: "signal",
      clearProps: "strokeDasharray,strokeDashoffset",
      scrollTrigger: {
        trigger: path.ownerSVGElement ?? path,
        start: "top 85%",
        once: true,
      },
    },
  );
}

/* P4 — bounded scrub parallax ----------------------------------------------
 *
 * Written to a custom property, never to `transform`, because most of the
 * elements worth parallaxing already compose a transform from tilt and depth
 * variables. The range is deliberately small: this is depth, not travel. */
export function parallax(
  element: HTMLElement | null,
  options: {
    trigger?: Element;
    from?: number;
    to?: number;
    property?: string;
  } = {},
): void {
  if (!element) return;

  const {
    trigger = element,
    from = 24,
    to = -24,
    property = "--stage-parallax",
  } = options;

  gsap.fromTo(
    element,
    { [property]: `${from}px` },
    {
      [property]: `${to}px`,
      ease: "none",
      scrollTrigger: {
        trigger,
        start: "top bottom",
        end: "bottom top",
        scrub: 0.6,
      },
    },
  );
}

/* An idle drift that keeps a composition breathing without asking for
 * attention. Amplitude stays under half a line of text. */
export function drift(
  elements: HTMLElement[],
  options: { amount?: number; base?: number; property?: string } = {},
): void {
  const { amount = 7, base = 6.5, property } = options;

  for (const [index, element] of elements.entries()) {
    const shared = {
      duration: base + jitter(index, 3),
      delay: jitter(index + 3, 1.5),
      repeat: -1,
      yoyo: true,
      ease: "sine.inOut",
    } as const;

    /* Elements that already compose their own transform drift through a custom
     * property so this never overwrites their depth or tilt. */
    if (property) {
      gsap.fromTo(
        element,
        { [property]: `${-amount / 2}px` },
        { [property]: `${amount / 2}px`, ...shared },
      );
      continue;
    }
    gsap.to(element, { y: `+=${amount}`, ...shared });
  }
}

/* Convenience for the many "every card in this grid" cases. */
export function settleChildren(
  root: ParentNode | null,
  selector: string,
  stagger = 0.06,
): void {
  if (!root) return;
  settleIn(qa(selector, root), { stagger });
}

export { MotionPathPlugin };
