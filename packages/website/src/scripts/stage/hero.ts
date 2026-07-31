/* §1 Hero.
 *
 * Two movements. On load the copy arrives line by line and the live-run panel
 * settles out of depth; on scroll the composition lifts away. The transcript
 * inside the panel is driven by `scripts/run-sim.ts`, not by the stage: the
 * stage choreographs the frame, the sim owns the content.
 */

import { revealLines } from "./primitives";
import { allowEntrance, gsap, q, qa } from "./runtime";

export function heroStage(): void {
  const hero = q("[data-hero]");
  if (!hero) return;

  const deck = q("[data-hero-deck]", hero);
  const copy = q("[data-hero-copy]", hero);
  const glow = q(".hero-glow", hero);
  const cue = q(".hero-cue", hero);

  /* The hero owns its own entrance, so the generic reveal pass must not claim
   * these wrappers as well. */
  const wrappers = qa("[data-reveal]", hero);
  for (const wrapper of wrappers) wrapper.classList.add("is-revealed");

  const title = q(".display-title", hero);
  const lede = q(".hero-lede", hero);
  const badge = q(".badge", hero);
  const actions = q(".hero-actions", hero);
  const install = q(".hero-install", hero);
  const charge = q(".hero-charge", hero);

  if (allowEntrance) {
    const intro = gsap.timeline({ defaults: { ease: "settle" } });

    if (badge) {
      intro.from(badge, { opacity: 0, scale: 0.9, y: 8, duration: 0.5 }, 0);
    }

    /* The deck starts furthest back and takes the longest to arrive, so the
     * copy is readable well before the composition finishes settling. */
    if (deck) {
      intro.fromTo(
        deck,
        {
          "--deck-enter-y": "34px",
          "--deck-enter-rotate": "9deg",
          "--deck-scale": 0.955,
          opacity: 0,
        },
        {
          "--deck-enter-y": "0px",
          "--deck-enter-rotate": "0deg",
          "--deck-scale": 1,
          opacity: 1,
          duration: 1.2,
        },
        0.25,
      );
    }

    /* The headline's underline charges like an axon once the line it belongs
     * to has arrived. */
    if (charge) {
      intro.fromTo(
        charge,
        { "--charge": 0 },
        { "--charge": 1, duration: 0.9, ease: "signal" },
        0.5,
      );
    }

    for (const [index, target] of [actions, install].entries()) {
      if (!target) continue;
      intro.from(
        target,
        { opacity: 0, y: 14, duration: 0.6 },
        0.55 + index * 0.08,
      );
    }

    /* One brightness pulse through the dendrite canvas, timed to land with the
     * deck. `dendrite-field.ts` owns the rendering. */
    intro.call(
      () => window.dispatchEvent(new CustomEvent("nerve:hero-charge")),
      undefined,
      0.95,
    );
  } else if (charge) {
    gsap.set(charge, { "--charge": 1 });
  }

  revealLines(title, { stagger: 0.09, delay: 0.05 });
  revealLines(lede, { stagger: 0.05, delay: 0.4 });

  /* Scroll-out. Everything is written to custom properties because the deck
   * composes its transform from tilt and depth variables it already owns. */
  const out = gsap.timeline({
    scrollTrigger: {
      trigger: hero,
      start: "top top",
      end: "bottom top",
      scrub: 0.6,
    },
    defaults: { ease: "none" },
  });

  if (deck) {
    out.fromTo(
      deck,
      { "--deck-rotate-x": "2deg", "--deck-lift": "0px", "--deck-scale": 1 },
      {
        "--deck-rotate-x": "0deg",
        "--deck-lift": "-28px",
        "--deck-scale": 0.97,
      },
      0,
    );
  }
  if (copy) {
    out.fromTo(
      copy,
      { "--copy-shift": "0px", opacity: 1 },
      { "--copy-shift": "22px", opacity: 0.7 },
      0,
    );
  }
  if (glow) out.fromTo(glow, { opacity: 0.18 }, { opacity: 0.05 }, 0);
  if (cue) out.to(cue, { opacity: 0, duration: 0.12 }, 0);
}
