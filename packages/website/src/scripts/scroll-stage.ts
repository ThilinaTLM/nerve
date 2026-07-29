/* Scroll-linked choreography for the landing page.
 *
 * Every stage here is additive: the authored DOM is already complete and
 * correct, and each function bails out early under reduced motion or when its
 * root element is absent. Nothing in this module is required for the page to be
 * readable, and no stage may change layout — only transform, opacity, filter,
 * and stroke-dashoffset are touched.
 *
 * `scroll()` from Motion uses the native ScrollTimeline where the browser
 * supports it, so the pinned stage runs off the main thread on modern engines
 * and falls back to a rAF-driven callback elsewhere.
 */

import { scroll } from "motion";

const reduceMotion = (): boolean =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;

const clamp = (value: number, min = 0, max = 1): number =>
  value < min ? min : value > max ? max : value;

/* Normalises `value` from the range [from, to] into 0..1. */
const range = (value: number, from: number, to: number): number =>
  clamp((value - from) / (to - from));

const easeInOut = (t: number): number =>
  t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;

const mix = (from: number, to: number, t: number): number =>
  from + (to - from) * t;

/* §1 Hero -------------------------------------------------------------------
 * The device deck settles flat and lifts away as the hero scrolls out, and the
 * floating event chips fall back toward the frame they came from. */
function heroStage(): VoidFunction | undefined {
  const hero = document.querySelector<HTMLElement>("[data-hero]");
  if (!hero || reduceMotion()) return;

  const deck = hero.querySelector<HTMLElement>("[data-hero-deck]");
  const copy = hero.querySelector<HTMLElement>("[data-hero-copy]");
  const chips = [...hero.querySelectorAll<HTMLElement>("[data-hero-chip]")];

  const stop = scroll(
    (progress: number) => {
      const p = clamp(progress);
      if (deck) {
        deck.style.setProperty("--deck-rotate-x", `${mix(2, 0, p)}deg`);
        deck.style.setProperty("--deck-lift", `${mix(0, -24, p)}px`);
      }
      if (copy) {
        copy.style.setProperty("--copy-shift", `${mix(0, 16, p)}px`);
        copy.style.opacity = String(mix(1, 0.78, p));
      }
      for (const chip of chips) {
        chip.style.opacity = String(mix(1, 0.65, p));
        chip.style.setProperty("--chip-z", `${mix(150, 0, p)}px`);
      }
    },
    { target: hero, offset: ["start start", "end start"] },
  );

  return () => {
    stop();
    deck?.style.removeProperty("--deck-rotate-x");
    deck?.style.removeProperty("--deck-lift");
    if (copy) {
      copy.style.removeProperty("--copy-shift");
      copy.style.removeProperty("opacity");
    }
    for (const chip of chips) {
      chip.style.removeProperty("opacity");
      chip.style.removeProperty("--chip-z");
    }
  };
}

/* §3 Anatomy of a run -------------------------------------------------------
 * The signature section. Four phases over the pinned scroll:
 *   0.00-0.16  flat       — a complete ordinary transcript
 *   0.16-0.30  separate   — layers gain shallow isometric depth
 *   0.30-0.84  the gate   — the complete deck holds while the signal resolves
 *   0.84-1.00  resolve    — the deck returns flat, fully illuminated
 *
 * Legibility governs the numbers. The tilt is deliberately shallow (18deg, not
 * a true isometric) and the dim state never drops a row below half opacity,
 * because every row is real content a reader is meant to be able to read at any
 * scroll position. Emphasis is carried by border and elevation instead. */
function anatomyStage(): VoidFunction | undefined {
  const section = document.querySelector<HTMLElement>("[data-anatomy]");
  if (!section || reduceMotion()) return;

  const layers = [...section.querySelectorAll<HTMLElement>("[data-layer]")];
  const captions = [...section.querySelectorAll<HTMLElement>("[data-caption]")];
  if (!layers.length) return;

  /* Only now does the pinned presentation take over from the static list. */
  section.dataset.stageReady = "true";

  const compact = matchMedia("(max-width: 767px)");
  const gateIndex = layers.findIndex(
    (layer) => layer.dataset.layerGate === "true",
  );

  /* Phase boundaries, shared by the geometry and the captions so a caption can
   * never describe a state the deck is not in. */
  const EXPLODE_FROM = 0.16;
  const EXPLODE_TO = 0.3;
  const GATE_OPENS = 0.72;
  const COLLAPSE_FROM = 0.84;

  const stop = scroll(
    (progress: number) => {
      const p = clamp(progress);
      const explode = easeInOut(range(p, EXPLODE_FROM, EXPLODE_TO));
      const collapse = easeInOut(range(p, COLLAPSE_FROM, 1));
      /* Separation rises during the explode phase and returns to zero as the
       * deck resolves, so both transitions share one value. */
      const spread = explode * (1 - collapse);
      const isCompact = compact.matches;

      /* The flat state is still a complete transcript. Depth changes the
       * presentation, never whether the seven rows can be read. */
      const gapFrom = isCompact ? 44 : 46;
      const gapTo = isCompact ? 54 : 52;
      const gap = mix(gapFrom, gapTo, spread);

      for (const [index, layer] of layers.entries()) {
        layer.style.setProperty(
          "--layer-rotate",
          `${isCompact ? 0 : 18 * spread}deg`,
        );
        layer.style.setProperty(
          "--layer-z",
          `${mix(0, isCompact ? -22 : -46, spread) * index}px`,
        );
        layer.style.setProperty("--layer-y", `${gap * index}px`);

        /* The descending impulse illuminates one layer at a time. Layers past
         * the review gate stay dim until the gate resolves. */
        const arrival = EXPLODE_TO + index * 0.035;
        let lit = range(p, arrival - 0.03, arrival + 0.05);
        if (gateIndex >= 0 && index > gateIndex) {
          lit = Math.min(lit, range(p, GATE_OPENS, GATE_OPENS + 0.05));
        }
        const illumination = Math.max(lit, collapse);
        layer.style.setProperty("--layer-lit", String(illumination));
        layer.dataset.layerActive = illumination > 0.55 ? "true" : "false";
      }

      if (gateIndex >= 0) {
        const reached = EXPLODE_TO + gateIndex * 0.035;
        const gate = layers[gateIndex];
        gate?.setAttribute(
          "data-gate-state",
          p >= GATE_OPENS ? "approved" : p >= reached ? "waiting" : "idle",
        );
      }

      /* Captions cross-fade with the phase they describe. */
      const phase =
        p < EXPLODE_FROM
          ? 0
          : p < EXPLODE_TO + 0.04
            ? 1
            : p < GATE_OPENS + 0.04
              ? 2
              : 3;
      for (const [index, caption] of captions.entries()) {
        caption.dataset.captionActive = String(index === phase);
      }
    },
    { target: section, offset: ["start start", "end end"] },
  );

  return () => {
    stop();
    delete section.dataset.stageReady;
    for (const [index, layer] of layers.entries()) {
      layer.style.removeProperty("--layer-rotate");
      layer.style.removeProperty("--layer-z");
      layer.style.removeProperty("--layer-y");
      layer.style.removeProperty("--layer-lit");
      delete layer.dataset.layerActive;
      if (layer.dataset.layerGate === "true") {
        layer.dataset.gateState = "idle";
      }
      captions[index]?.removeAttribute("data-caption-active");
    }
    for (const [index, caption] of captions.entries()) {
      caption.dataset.captionActive = String(index === 0);
    }
  };
}

/* §5 Workbench tour ---------------------------------------------------------
 * The media column is sticky; the copy column drives which shot is shown. */
function tourStage(): void {
  const tour = document.querySelector<HTMLElement>("[data-tour]");
  if (!tour) return;

  const stops = [...tour.querySelectorAll<HTMLElement>("[data-tour-stop]")];
  if (!stops.length) return;

  const setActive = (index: number): void => {
    if (tour.dataset.active === String(index)) return;
    tour.dataset.active = String(index);
    for (const [position, stop] of stops.entries()) {
      stop.dataset.stopActive = String(position === index);
    }
  };

  setActive(0);

  /* A band across the middle of the viewport decides the active stop. Using an
   * observer rather than a scroll handler keeps this cheap and accurate when
   * the sticky frame changes height. */
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const index = stops.indexOf(entry.target as HTMLElement);
        if (index >= 0) setActive(index);
      }
    },
    { rootMargin: "-38% 0px -52% 0px", threshold: 0 },
  );

  for (const stop of stops) observer.observe(stop);
}

/* Entry choreography finishes independently of further scroll input. Pausing
 * with a diagram in view can therefore never strand it half drawn. */
function observeOnce(target: Element, enter: VoidFunction): VoidFunction {
  if (!("IntersectionObserver" in window)) {
    enter();
    return () => undefined;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      enter();
      observer.disconnect();
    },
    { threshold: 0.01, rootMargin: "0px 0px 14% 0px" },
  );
  observer.observe(target);
  return () => observer.disconnect();
}

function drawPaths(root: HTMLElement): VoidFunction | undefined {
  const paths = [...root.querySelectorAll<SVGPathElement>("[data-draw-path]")];
  if (!paths.length || reduceMotion()) return;

  const lengths = paths.map((path, index) => {
    const length = path.getTotalLength();
    path.style.strokeDasharray = String(length);
    path.style.strokeDashoffset = String(length);
    path.style.transition = `stroke-dashoffset 520ms var(--ease-out-expo) ${index * 45}ms`;
    return length;
  });

  const stop = observeOnce(root, () => {
    requestAnimationFrame(() => {
      for (const path of paths) path.style.strokeDashoffset = "0";
    });
  });

  return () => {
    stop();
    for (const [index, path] of paths.entries()) {
      path.style.removeProperty("stroke-dasharray");
      path.style.removeProperty("stroke-dashoffset");
      path.style.removeProperty("transition");
      void lengths[index];
    }
  };
}

function diagramStages(): VoidFunction[] {
  if (reduceMotion()) return [];
  const cleanups: VoidFunction[] = [];
  for (const root of document.querySelectorAll<HTMLElement>("[data-draw]")) {
    const cleanup = drawPaths(root);
    if (cleanup) cleanups.push(cleanup);
  }
  return cleanups;
}

/* The workflow signal now completes once it enters, with CSS delays carrying
 * the station sequence. Its resting state is always the complete workflow. */
function arcStage(): VoidFunction | undefined {
  const arc = document.querySelector<HTMLElement>("[data-arc]");
  if (!arc || reduceMotion()) return;

  const stations = [...arc.querySelectorAll<HTMLElement>("[data-station]")];
  if (stations.length < 2) return;

  arc.dataset.arcReady = "true";
  for (const station of stations) {
    station.dataset.stationActive = "false";
    station.style.setProperty("--segment", "0");
  }

  const stop = observeOnce(arc, () => {
    requestAnimationFrame(() => {
      for (const station of stations) {
        station.dataset.stationActive = "true";
        station.style.setProperty("--segment", "1");
      }
    });
  });

  return () => {
    stop();
    delete arc.dataset.arcReady;
    for (const station of stations) {
      station.dataset.stationActive = "true";
      station.style.removeProperty("--segment");
    }
  };
}

/* The phone deck opens once, then remains in its finished composition. */
function pocketStage(): VoidFunction | undefined {
  const pocket = document.querySelector<HTMLElement>("[data-pocket]");
  if (!pocket || reduceMotion()) return;

  pocket.dataset.arcReady = "true";
  pocket.style.setProperty("--arc-open", "0");
  const stop = observeOnce(pocket, () => {
    requestAnimationFrame(() => pocket.style.setProperty("--arc-open", "1"));
  });

  return () => {
    stop();
    delete pocket.dataset.arcReady;
    pocket.style.removeProperty("--arc-open");
  };
}

export function initScrollStages(): void {
  const cleanups: VoidFunction[] = [];
  const heroCleanup = heroStage();
  if (heroCleanup) cleanups.push(heroCleanup);
  const anatomyCleanup = anatomyStage();
  if (anatomyCleanup) cleanups.push(anatomyCleanup);
  tourStage();
  cleanups.push(...diagramStages());
  const arcCleanup = arcStage();
  if (arcCleanup) cleanups.push(arcCleanup);
  const pocketCleanup = pocketStage();
  if (pocketCleanup) cleanups.push(pocketCleanup);

  matchMedia("(prefers-reduced-motion: reduce)").addEventListener(
    "change",
    (event) => {
      if (!event.matches) return;
      for (const cleanup of cleanups) cleanup();
    },
    { once: true },
  );
}
