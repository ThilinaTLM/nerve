/* The four diagram sections: capability lattice, resilience trace, workflow
 * arc, and local-first topology.
 *
 * They share one claim — nothing lights up on its own, it lights up because a
 * signal reached it — so they share one primitive (`conduct`) and live in one
 * module rather than four near-identical files.
 */

import {
  conduct,
  drawPath,
  parallax,
  revealLines,
  settleIn,
  travelDash,
} from "./primitives";
import { COMPACT, DESKTOP, gsap, q, qa, ScrollTrigger } from "./runtime";

/* §6 Capability lattice ---------------------------------------------------- */
export function latticeStage(): void {
  const lattice = q("[data-lattice]");
  if (!lattice) return;

  const cards = qa(".lattice-card", lattice);
  settleIn(cards, { stagger: 0.05 });

  const media = gsap.matchMedia();

  media.add(DESKTOP, () => {
    const branches = qa<SVGPathElement>(".branch-signal", lattice);

    for (const [index, branch] of branches.entries()) {
      const card = cards[index];
      let charged = false;

      conduct(branch, {
        index,
        duration: 1.9,
        gap: 1.4,
        onProgress: (progress) => {
          /* The card responds when the impulse lands on its bouton, not when
           * the traversal begins. */
          const arrived = progress > 0.88;
          if (arrived === charged) return;
          charged = arrived;
          card?.classList.toggle("is-charged", arrived);
        },
      });
    }

    /* The soma breathes from GSAP so it can be paused off-screen. */
    const halo = q(".soma-halo", lattice);
    if (halo) {
      gsap.to(halo, {
        scale: 1.035,
        transformOrigin: "center",
        duration: 3.5,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
      });
    }

    return () => {
      for (const card of cards) card.classList.remove("is-charged");
    };
  });
}

/* §7 Resilience ------------------------------------------------------------ */
export function resilienceStage(): void {
  const resilience = q(".resilience");
  if (!resilience) return;

  settleIn(qa(".resilience-card", resilience), { stagger: 0.07 });
  revealLines(q(".history-title", resilience));
  parallax(q(".history-media", resilience), {
    trigger: q(".history", resilience) ?? resilience,
    from: 22,
    to: -22,
    property: "--stage-parallax",
  });

  const trace = q<SVGPathElement>(".trace-live", resilience);
  if (!trace) return;

  const wrap = q(".trace-wrap", resilience);

  drawPath(trace);

  /* The trace reads as a story: steady firing, a flat stretch where the run
   * fails, then a full re-fire. The labels light with the phase the travelling
   * segment is in. */
  travelDash(trace, {
    duration: 4.2,
    gap: 0.9,
    segment: 90,
    onProgress: (progress) => {
      if (!wrap) return;
      wrap.dataset.traceState =
        progress > 0.42 && progress < 0.66
          ? "failing"
          : progress >= 0.66
            ? "recovered"
            : "firing";
    },
  });
}

/* §9 Workflow arc ---------------------------------------------------------- */
export function reflexStage(): void {
  const arc = q("[data-arc]");
  if (!arc) return;

  const stations = qa("[data-station]", arc);
  if (stations.length < 2) return;

  const build = (scrub: boolean) => (): VoidFunction => {
    arc.dataset.arcReady = "true";

    const timeline = gsap.timeline({
      defaults: { ease: "none" },
      scrollTrigger: scrub
        ? { trigger: arc, start: "top 76%", end: "bottom 66%", scrub: 0.6 }
        : { trigger: arc, start: "top 82%", once: true },
    });

    /* Two scrubbed values per station and no callbacks: the sequence is a pure
     * function of scroll position, forwards and backwards. */
    for (const [index, station] of stations.entries()) {
      timeline
        .fromTo(
          station,
          { "--lit": 0 },
          { "--lit": 1, duration: 0.1 },
          index * 0.22,
        )
        .fromTo(
          station,
          { "--segment": 0 },
          { "--segment": 1, duration: 0.22 },
          index * 0.22 + 0.05,
        );
    }

    return () => {
      delete arc.dataset.arcReady;
      for (const station of stations) {
        station.style.removeProperty("--segment");
        station.style.removeProperty("--lit");
      }
    };
  };

  const media = gsap.matchMedia();
  media.add(DESKTOP, build(true));
  media.add(COMPACT, build(false));
}

/* §10 Topology ------------------------------------------------------------- */
export function topologyStage(): void {
  const topology = q(".topology");
  if (!topology) return;

  const nodes = qa(".boundary-inner .node", topology);
  settleIn(nodes, { stagger: 0.08 });

  /* The internal links conduct freely. The rail runs vertically in the stacked
   * layout and horizontally once the nodes sit in a row. */
  const links = qa(".link-impulse", topology);
  const media = gsap.matchMedia();

  const conductLinks = (axis: "x" | "y", to: number) => (): void => {
    for (const [index, link] of links.entries()) {
      gsap.fromTo(
        link,
        { [axis]: -16, opacity: 0 },
        {
          [axis]: to,
          opacity: 1,
          duration: 1.5,
          delay: index * 0.4,
          repeat: -1,
          repeatDelay: 1.1,
          ease: "none",
        },
      );
    }
  };

  media.add("(min-width: 640px)", conductLinks("x", 58));
  media.add("(max-width: 639px)", conductLinks("y", 42));

  /* The egress impulse never completes: it fades out before it leaves. One
   * connection, only when you ask for it — as a behaviour, not a caption. */
  const egress = q(".egress-line", topology);
  if (!egress) return;

  const spark = document.createElement("span");
  spark.className = "egress-spark";
  spark.setAttribute("aria-hidden", "true");
  egress.append(spark);

  const timeline = gsap.timeline({
    repeat: -1,
    repeatDelay: 2.6,
    paused: true,
  });
  timeline
    .fromTo(
      spark,
      { y: -6, opacity: 0, scale: 1 },
      { y: 14, opacity: 1, duration: 0.9, ease: "none" },
    )
    .to(spark, { y: 22, scale: 2, opacity: 0, duration: 0.5, ease: "signal" });

  ScrollTrigger.create({
    trigger: topology,
    start: "top bottom",
    end: "bottom top",
    onToggle: (self) => {
      if (self.isActive) timeline.play();
      else timeline.pause();
    },
  });
}

export { drawPath };
