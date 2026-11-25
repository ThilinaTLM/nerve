/* §1 Hero.
 *
 * Two movements. On load the title settles in and the workbench art rises
 * into place; on scroll the composition lifts away. The film inside the
 * art is `scripts/marketing/hero-workbench.ts`.
 */

import { allowEntrance, gsap, q, qa } from "./runtime";

export function heroStage(): void {
  const hero = q("[data-hero]");
  if (!hero) return;

  const deck = q("[data-hero-deck]", hero);
  const copy = q("[data-hero-copy]", hero);
  const glow = q(".hero-glow", hero);

  /* The hero owns its own entrance, so the generic reveal pass must not claim
   * these wrappers as well. */
  const wrappers = qa("[data-reveal]", hero);
  for (const wrapper of wrappers) wrapper.classList.add("is-revealed");

  const title = q(".hero-title", hero);

  if (allowEntrance) {
    const intro = gsap.timeline({ defaults: { ease: "settle" } });

    if (title) intro.from(title, { opacity: 0, y: -10, duration: 0.7 }, 0.1);

    /* The deck starts furthest back and takes the longest to arrive. */
    if (deck) {
      intro.fromTo(
        deck,
        { "--deck-enter-y": "40px", opacity: 0 },
        { "--deck-enter-y": "0px", opacity: 1, duration: 1.2 },
        0.25,
      );
    }

    /* One brightness pulse through the dendrite canvas, timed to land with the
     * deck. `dendrite-field.ts` owns the rendering. */
    intro.call(
      () => window.dispatchEvent(new CustomEvent("nerve:hero-charge")),
      undefined,
      0.95,
    );
  }

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
    out.fromTo(deck, { "--deck-lift": "0px" }, { "--deck-lift": "-28px" }, 0);
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
}
