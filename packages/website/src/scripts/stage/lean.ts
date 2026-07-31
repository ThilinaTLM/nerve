/* §6 Lean harness.
 *
 * The mega-prompt wall dissolves into the one real sentence as the section
 * scrolls into view. The authored state is the resolved one — wall faded,
 * sentence bright — so the stage only replays how it got that way: it first
 * restores the wall to full noise, then scrubs it back out.
 */

import { jitter } from "./runtime";
import { gsap, q, qa } from "./runtime";

export function leanStage(): void {
  const lean = q("[data-lean]");
  if (!lean) return;

  const lines = qa("[data-lean-line]", lean);
  const core = q("[data-lean-core]", lean);
  const stage = q(".lean-stage", lean);
  if (!lines.length || !stage) return;

  const timeline = gsap.timeline({
    defaults: { ease: "none" },
    scrollTrigger: {
      trigger: stage,
      start: "top 88%",
      end: "center 45%",
      scrub: 0.5,
    },
  });

  /* Each fragment starts loud and burns away on its own jittered beat. */
  for (const [index, line] of lines.entries()) {
    const at = (index % 12) * 0.055 + jitter(index, 0.1);
    timeline.fromTo(
      line,
      {
        "--wall-opacity": 0.55,
        "--wall-blur": "0px",
        "--wall-shift": "0px",
      },
      {
        "--wall-opacity": 0.14,
        "--wall-blur": "2.5px",
        "--wall-shift": `${6 + jitter(index, 10)}px`,
        duration: 0.4,
      },
      at,
    );
  }

  if (core) {
    timeline.fromTo(
      core,
      { "--core-lit": 0.25 },
      { "--core-lit": 1, duration: 0.55 },
      0.35,
    );
  }
}
