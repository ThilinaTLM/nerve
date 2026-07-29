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
function heroStage(): void {
  const hero = document.querySelector<HTMLElement>("[data-hero]");
  if (!hero || reduceMotion()) return;

  const deck = hero.querySelector<HTMLElement>("[data-hero-deck]");
  const copy = hero.querySelector<HTMLElement>("[data-hero-copy]");
  const chips = [...hero.querySelectorAll<HTMLElement>("[data-hero-chip]")];

  scroll(
    (progress: number) => {
      const p = clamp(progress);
      if (deck) {
        deck.style.setProperty("--deck-rotate-x", `${mix(4, 0, p)}deg`);
        deck.style.setProperty("--deck-lift", `${mix(0, -48, p)}px`);
      }
      if (copy) {
        copy.style.setProperty("--copy-shift", `${mix(0, 32, p)}px`);
        copy.style.opacity = String(mix(1, 0.35, p));
      }
      for (const chip of chips) {
        chip.style.opacity = String(clamp(1 - p * 1.6));
        chip.style.setProperty("--chip-z", `${mix(150, 0, p)}px`);
      }
    },
    { target: hero, offset: ["start start", "end start"] },
  );
}

/* §3 Anatomy of a run -------------------------------------------------------
 * The signature section. Four phases over the pinned scroll:
 *   0.00-0.12  collapsed  — reads as one ordinary transcript
 *   0.12-0.45  explode    — layers separate into a shallow isometric deck
 *   0.45-0.86  the gate   — an impulse descends and halts at the approval layer
 *   0.86-1.00  resolve    — the deck re-collapses, fully illuminated
 *
 * Legibility governs the numbers. The tilt is deliberately shallow (18deg, not
 * a true isometric) and the dim state never drops a row below half opacity,
 * because every row is real content a reader is meant to be able to read at any
 * scroll position. Emphasis is carried by border and elevation instead. */
function anatomyStage(): void {
  const section = document.querySelector<HTMLElement>("[data-anatomy]");
  if (!section || reduceMotion()) return;

  const layers = [...section.querySelectorAll<HTMLElement>("[data-layer]")];
  const captions = [...section.querySelectorAll<HTMLElement>("[data-caption]")];
  const closing = section.querySelector<HTMLElement>("[data-anatomy-closing]");
  if (!layers.length) return;

  /* Only now does the pinned presentation take over from the static list. */
  section.dataset.stageReady = "true";

  const compact = matchMedia("(max-width: 767px)");
  const gateIndex = layers.findIndex(
    (layer) => layer.dataset.layerGate === "true",
  );
  const stack = section.querySelector<HTMLElement>("[data-event-stack]");
  const last = layers.length - 1;

  /* Phase boundaries, shared by the geometry and the captions so a caption can
   * never describe a state the deck is not in. */
  const EXPLODE_FROM = 0.12;
  const EXPLODE_TO = 0.45;
  const GATE_OPENS = 0.72;
  const COLLAPSE_FROM = 0.86;

  scroll(
    (progress: number) => {
      const p = clamp(progress);
      const explode = easeInOut(range(p, EXPLODE_FROM, EXPLODE_TO));
      const collapse = easeInOut(range(p, COLLAPSE_FROM, 1));
      /* Separation rises during the explode phase and returns to zero as the
       * deck resolves, so both transitions share one value. */
      const spread = explode * (1 - collapse);
      const isCompact = compact.matches;

      const gapFrom = 4;
      const gapTo = isCompact ? 58 : 54;
      const gap = mix(gapFrom, gapTo, spread);

      /* Hold the deck vertically centred as it expands and contracts, so it
       * never drifts to the top of the pinned frame. */
      stack?.style.setProperty("--stack-shift", `${(gap * last) / 2}px`);

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
        p < EXPLODE_FROM + 0.02
          ? 0
          : p < EXPLODE_TO + 0.02
            ? 1
            : p < GATE_OPENS + 0.06
              ? 2
              : 3;
      for (const [index, caption] of captions.entries()) {
        caption.dataset.captionActive = String(index === phase);
      }

      if (closing) {
        closing.style.opacity = String(range(p, COLLAPSE_FROM + 0.04, 0.99));
        closing.style.setProperty(
          "--closing-scale",
          String(mix(0.94, 1, range(p, COLLAPSE_FROM + 0.04, 1))),
        );
      }
    },
    { target: section, offset: ["start start", "end end"] },
  );
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
    { rootMargin: "-45% 0px -45% 0px", threshold: 0 },
  );

  for (const stop of stops) observer.observe(stop);
}

/* The scroll offsets a diagram may finish on. Kept as a closed union so the
 * `data-draw-end` attribute cannot smuggle an unsupported value into Motion. */
type DrawEnd = "center center" | "end center" | "end start";

function isDrawEnd(value: string | undefined): value is DrawEnd {
  return (
    value === "center center" || value === "end center" || value === "end start"
  );
}

/* Draws an SVG path by animating stroke-dashoffset as the element enters. */
function drawPaths(
  root: HTMLElement,
  offsetEnd: DrawEnd = "center center",
): void {
  const paths = [...root.querySelectorAll<SVGPathElement>("[data-draw-path]")];
  if (!paths.length) return;

  const lengths = paths.map((path) => {
    const length = path.getTotalLength();
    path.style.strokeDasharray = String(length);
    path.style.strokeDashoffset = String(length);
    return length;
  });

  scroll(
    (progress: number) => {
      const p = easeInOut(clamp(progress));
      for (const [index, path] of paths.entries()) {
        /* Stagger so branches fire in sequence rather than all at once. */
        const start = (index / paths.length) * 0.45;
        const local = range(p, start, start + 0.55);
        path.style.strokeDashoffset = String(lengths[index] * (1 - local));
      }
    },
    { target: root, offset: ["start end", offsetEnd] },
  );
}

/* §7 Resilience, §9 Reflex arc, §10 Topology --------------------------------
 * All three are entry-drawn diagrams. Only the reflex arc additionally rides an
 * impulse along its path. */
function diagramStages(): void {
  if (reduceMotion()) return;

  for (const root of document.querySelectorAll<HTMLElement>("[data-draw]")) {
    const end = root.dataset.drawEnd;
    drawPaths(root, isDrawEnd(end) ? end : "center center");
  }

  arcStage();
}

/* §9 Reflex arc — the impulse travels from the first station to the last,
 * filling each axon segment as it passes and lighting the station it reaches. */
function arcStage(): void {
  const arc = document.querySelector<HTMLElement>("[data-arc]");
  if (!arc || reduceMotion()) return;

  const stations = [...arc.querySelectorAll<HTMLElement>("[data-station]")];
  if (stations.length < 2) return;

  /* Arrivals are spread across the middle of the entry range so the first
   * station is already lit when the section settles and the last one still has
   * room to arrive before the section leaves. */
  const first = 0.12;
  const last = 0.82;
  const arrivals = stations.map(
    (_, index) => first + ((last - first) * index) / (stations.length - 1),
  );

  scroll(
    (progress: number) => {
      const p = easeInOut(clamp(progress));
      for (const [index, station] of stations.entries()) {
        station.dataset.stationActive = String(p >= arrivals[index]);
        const next = arrivals[index + 1];
        if (next !== undefined) {
          station.style.setProperty(
            "--segment",
            String(range(p, arrivals[index], next)),
          );
        }
      }
    },
    { target: arc, offset: ["start end", "end center"] },
  );
}

/* §8 Pocket workbench — the phone arc opens as the section enters. */
function pocketStage(): void {
  const pocket = document.querySelector<HTMLElement>("[data-pocket]");
  if (!pocket || reduceMotion()) return;

  scroll(
    (progress: number) => {
      pocket.style.setProperty(
        "--arc-open",
        String(easeInOut(clamp(progress))),
      );
    },
    { target: pocket, offset: ["start end", "center center"] },
  );
}

export function initScrollStages(): void {
  heroStage();
  anatomyStage();
  tourStage();
  diagramStages();
  pocketStage();
}
