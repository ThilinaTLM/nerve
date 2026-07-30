/* Shared GSAP runtime for the marketing stage.
 *
 * This module is only ever reached through a dynamic import from
 * `scripts/motion.ts`, and only when the visitor has not asked for reduced
 * motion. Everything downstream can therefore assume GSAP is present and that
 * animating is allowed.
 *
 * Two rules govern every stage built on top of this:
 *
 *   1. The authored DOM is already complete. A stage may only change how it is
 *      presented, never whether it can be read.
 *   2. Elements that compose their own transform from custom properties
 *      (`--tilt-*`, `--deck-*`, `--layer-*`) are animated through those
 *      properties, never through `transform` directly.
 */

import { gsap } from "gsap";
import { CustomEase } from "gsap/CustomEase";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";

gsap.registerPlugin(CustomEase, MotionPathPlugin, ScrollTrigger, SplitText);

/* Named to match the CSS tokens so a transition and a tween of the same value
 * are indistinguishable. */
CustomEase.create("signal", "0.16,1,0.3,1");
CustomEase.create("settle", "0.22,1,0.28,1");

gsap.defaults({ ease: "signal", duration: 0.8 });

/* Mobile browsers resize the viewport when their URL bar collapses. Refreshing
 * pinned triggers on that resize causes a visible jump for no benefit. */
ScrollTrigger.config({ ignoreMobileResize: true });

/* Entrance animations are worth playing only if the runtime arrived before the
 * visitor has had time to read the page. On a cold cache over a slow link the
 * module can land seconds after first paint, and hiding already-read content in
 * order to animate it back in is strictly worse than doing nothing. Scroll
 * linked stages still attach either way. */
export const allowEntrance: boolean = performance.now() < 1200;

export const DESKTOP = "(min-width: 1024px)";
export const COMPACT = "(max-width: 1023px)";
export const WIDE = "(min-width: 1280px)";
export const FINE_POINTER = "(hover: hover) and (pointer: fine)";

export { gsap, MotionPathPlugin, ScrollTrigger, SplitText };

export const q = <T extends Element = HTMLElement>(
  selector: string,
  root: ParentNode = document,
): T | null => root.querySelector<T>(selector);

export const qa = <T extends Element = HTMLElement>(
  selector: string,
  root: ParentNode = document,
): T[] => [...root.querySelectorAll<T>(selector)];

/* SplitText measures line boxes. Splitting before the webfont swaps produces
 * lines that are wrong by a word, so every heading reveal waits for fonts —
 * but never for longer than it would take a reader to notice. */
export async function fontsReady(): Promise<void> {
  if (!("fonts" in document)) return;
  await Promise.race([
    document.fonts.ready,
    new Promise((resolve) => setTimeout(resolve, 600)),
  ]);
}

/* Lazy images and webfonts change the height of the page after the first
 * measurement pass, which leaves pinned sections measured against a layout that
 * no longer exists. */
export function refreshOnAssets(): void {
  const refresh = (): void => ScrollTrigger.refresh();
  if (document.readyState === "complete") requestAnimationFrame(refresh);
  else window.addEventListener("load", () => requestAnimationFrame(refresh));
  if ("fonts" in document) void document.fonts.ready.then(refresh);
}

/* A continuous tween is only paid for while its subject is on screen and the
 * tab is in the foreground. */
export function playWhileVisible(
  trigger: Element,
  animation: gsap.core.Animation,
): void {
  let onScreen = false;

  const sync = (): void => {
    if (onScreen && document.visibilityState === "visible") animation.play();
    else animation.pause();
  };

  ScrollTrigger.create({
    trigger,
    start: "top bottom",
    end: "bottom top",
    onToggle: (self) => {
      onScreen = self.isActive;
      sync();
    },
  });

  document.addEventListener("visibilitychange", sync);
  sync();
}

/* Deterministic per-index jitter. Idle loops that share a duration read as a
 * single mechanism; desyncing them is what makes a composition feel alive. */
export function jitter(index: number, spread = 1): number {
  const value = Math.sin((index + 1) * 12.9898) * 43758.5453;
  return (value - Math.floor(value)) * spread;
}
