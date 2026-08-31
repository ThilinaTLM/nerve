/* Stage orchestration.
 *
 * Reached only through a dynamic import from `scripts/motion.ts`, and only when
 * the visitor has not asked for reduced motion. Order matters exactly once: the
 * hero claims its own subtree before the generic reveal pass runs, so the
 * headline is not animated twice.
 */

import { anatomyStage } from "./anatomy";
import { constellationStage } from "./constellation";
import { defaultsStage } from "./defaults";
import { heroStage } from "./hero";
import { leanStage } from "./lean";
import { revealLines, settleIn } from "./primitives";
import {
  fontsReady,
  gsap,
  q,
  qa,
  refreshOnAssets,
  ScrollTrigger,
} from "./runtime";
import {
  authorityStage,
  closingStage,
  pocketStage,
  signalStripStage,
} from "./sections";
import { tourStage } from "./tour";

/* Section headings and any block that opted into the generic arrival. Elements
 * claimed by a stage carry `is-revealed` already and are skipped. */
function revealPass(): void {
  /* Section headings get the masked line treatment; the eyebrow and lede that
   * frame them settle in behind it. */
  for (const header of qa(".section-header")) {
    revealLines(q(".section-title", header), { start: "top 86%" });
    settleIn(qa(".eyebrow, .lede", header), {
      stagger: 0.06,
      y: 14,
      start: "top 88%",
    });
  }

  /* Everything else that opted in, minus the headers handled above and the
   * containers whose children animate individually. */
  const pending = qa(
    "[data-reveal]:not(.section-header):not([data-reveal-stagger])",
  ).filter((element) => !element.classList.contains("is-revealed"));
  settleIn(pending, { stagger: 0.06 });

  for (const container of qa("[data-reveal-stagger]")) {
    container.classList.add("is-revealed");
    settleIn(qa("[data-reveal-child]", container), { stagger: 0.07, y: 18 });
  }
}

/* A fixed hairline that carries the page's scroll position as a travelling
 * charge. The page is modelled as one axon; this is the impulse on it. */
function axonRail(): void {
  const rail = q("[data-axon-rail]");
  if (!rail) return;

  gsap.fromTo(
    rail,
    { "--axon-progress": 0 },
    {
      "--axon-progress": 1,
      ease: "none",
      scrollTrigger: {
        trigger: document.body,
        start: "top top",
        end: "bottom bottom",
        scrub: 0.4,
      },
    },
  );
}

export function initStage(): void {
  document.documentElement.dataset.stageReady = "true";

  void fontsReady().then(() => {
    heroStage();
    revealPass();
    signalStripStage();
    anatomyStage();
    authorityStage();
    leanStage();
    constellationStage();
    tourStage();
    defaultsStage();
    pocketStage();
    closingStage();
    axonRail();

    refreshOnAssets();
    ScrollTrigger.refresh();
  });
}
