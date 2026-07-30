/* §3 Anatomy of a run — the signature section.
 *
 * The page's one pinned stage. Seven transcript rows fan into a shallow
 * isometric deck, an impulse descends the deck and *stops* at the review gate,
 * and once the gate resolves the remainder completes and the deck returns flat.
 *
 * The pin itself is CSS (`position: sticky` on `.anatomy-pin`), so there is no
 * pin spacer to measure and nothing to fight the sticky site header. This
 * module only maps scroll progress onto custom properties.
 *
 * Phase map, in scroll progress:
 *   0.00-0.14  flat      a complete, ordinary transcript
 *   0.14-0.30  separate  rows unzip downward into depth
 *   0.30-0.62  conduct   the impulse descends, lighting each row it reaches
 *   0.62-0.72  gate      it halts at the approval row
 *   0.72-0.84  release   the gate resolves and the rest completes
 *   0.84-1.00  resolve   the deck returns flat, fully illuminated
 */

import { revealLines, settleIn } from "./primitives";
import { COMPACT, DESKTOP, gsap, q, qa } from "./runtime";

const SEPARATE = 0.14;
const CONDUCT = 0.3;
const GATE_REACHED = 0.62;
const GATE_OPENS = 0.72;
const COLLAPSE = 0.84;

/* Matches --flat-gap and its separated value in AnatomyOfARun.astro. */
const FLAT_GAP = 60;
const SPREAD_GAP = 66;
const DEPTH_STEP = -48;

/* Where each row lights, spread across the conduct phase. */
const rowArrival = (index: number): number => CONDUCT + index * 0.064;

export function anatomyStage(): void {
  const section = q("[data-anatomy]");
  if (!section) return;

  const layers = qa("[data-layer]", section);
  const captions = qa("[data-caption]", section);
  if (!layers.length) return;

  const gateIndex = layers.findIndex(
    (layer) => layer.dataset.layerGate === "true",
  );

  /* Discrete state: the gate, and which caption is on screen. Scroll position
   * already selects a phase, so captions switch rather than cross-fade — two
   * captions must never be legible at once. */
  const sync = (progress: number): void => {
    if (gateIndex >= 0) {
      layers[gateIndex]?.setAttribute(
        "data-gate-state",
        progress >= GATE_OPENS
          ? "approved"
          : progress >= rowArrival(gateIndex)
            ? "waiting"
            : "idle",
      );
    }

    const phase =
      progress < SEPARATE + 0.02
        ? 0
        : progress < GATE_REACHED - 0.04
          ? 1
          : progress < GATE_OPENS + 0.02
            ? 2
            : 3;

    for (const [index, caption] of captions.entries()) {
      caption.dataset.captionActive = String(index === phase);
    }
  };

  const media = gsap.matchMedia();

  media.add(DESKTOP, () => {
    /* Only now does the pinned presentation replace the static list. */
    section.dataset.stageReady = "true";

    const timeline = gsap.timeline({
      defaults: { ease: "none" },
      scrollTrigger: {
        trigger: section,
        start: "top top",
        end: "bottom bottom",
        scrub: 0.6,
        onUpdate: (self) => sync(self.progress),
        onRefresh: (self) => sync(self.progress),
      },
    });

    /* Separate — the deck unzips downward rather than tilting as one block. */
    timeline.fromTo(
      layers,
      {
        "--layer-rotate": "0deg",
        "--layer-z": "0px",
        "--layer-y": (i: number) => `${FLAT_GAP * i}px`,
      },
      {
        "--layer-rotate": "18deg",
        "--layer-z": (i: number) => `${DEPTH_STEP * i}px`,
        "--layer-y": (i: number) => `${SPREAD_GAP * i}px`,
        duration: 0.12,
        stagger: { each: 0.007 },
        ease: "power2.inOut",
      },
      SEPARATE,
    );

    /* Conduct — one row at a time, each lit by the pip that reaches it. Rows
     * past the gate are deliberately left dark until it resolves. */
    for (const [index, layer] of layers.entries()) {
      const gated = gateIndex >= 0 && index > gateIndex;
      const at = gated
        ? GATE_OPENS + (index - gateIndex) * 0.03
        : rowArrival(index);
      const pip = q(".event-pulse", layer);

      timeline.fromTo(
        layer,
        { "--layer-lit": 0 },
        { "--layer-lit": 1, duration: 0.05 },
        index === 0 ? 0 : at,
      );

      if (!pip) continue;
      timeline
        .fromTo(
          pip,
          { opacity: 0, scale: 0.4 },
          { opacity: 1, scale: 1, duration: 0.02 },
          at,
        )
        .to(
          pip,
          { opacity: 0, scale: 0.4, duration: 0.03 },
          index === gateIndex ? GATE_OPENS : at + 0.05,
        );
    }

    /* Resolve — flat again, everything lit. */
    timeline.to(
      layers,
      {
        "--layer-rotate": "0deg",
        "--layer-z": "0px",
        "--layer-y": (i: number) => `${FLAT_GAP * i}px`,
        "--layer-lit": 1,
        duration: 0.16,
        ease: "power2.inOut",
      },
      COLLAPSE,
    );

    const glow = q(".anatomy-glow", section);
    if (glow) {
      timeline
        .fromTo(
          glow,
          { opacity: 0.25 },
          { opacity: 0.85, duration: 0.3 },
          CONDUCT,
        )
        .to(glow, { opacity: 0.5, duration: 0.16 }, COLLAPSE);
    }

    return () => {
      delete section.dataset.stageReady;
      for (const [index, caption] of captions.entries()) {
        caption.dataset.captionActive = String(index === 0);
      }
      layers[gateIndex]?.setAttribute("data-gate-state", "idle");
    };
  });

  /* Compact — no pin, no depth. The transcript arrives row by row and the gate
   * still resolves, because that is the point the section is making. */
  media.add(COMPACT, () => {
    settleIn(layers, { stagger: 0.07, y: 18 });

    const gate = gateIndex >= 0 ? layers[gateIndex] : undefined;
    if (!gate) return;

    gsap
      .timeline({
        scrollTrigger: { trigger: gate, start: "top 70%", once: true },
      })
      .call(() => {
        gate.dataset.gateState = "waiting";
      })
      .to({}, { duration: 1.1 })
      .call(() => {
        gate.dataset.gateState = "approved";
      });
  });

  revealLines(q("#anatomy-title", section));
}
