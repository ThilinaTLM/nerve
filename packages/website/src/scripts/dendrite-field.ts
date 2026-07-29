/* The dendrite backdrop.
 *
 * Draws an actual branching dendritic tree rather than the usual drifting
 * particle cloud: trunks anchored off-canvas recurse into tapering branches
 * that end in synaptic boutons, and a small number of impulses travel complete
 * root-to-tip paths.
 *
 * The geometry is seeded and deterministic, so the field is identical on every
 * reload and can be art-directed and screenshotted. Only the impulses and the
 * pointer's local membrane potential move; the tree itself is static, which
 * reads far more deliberately than drifting noise.
 *
 * Cost control: geometry is computed once per resize, DPR is capped at 2,
 * rendering pauses off-screen and on a hidden tab, and reduced motion paints a
 * single static frame and then stops.
 */

interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  length: number;
  tip: boolean;
}

interface Impulse {
  path: number[];
  /* Distance travelled along the concatenated path, in pixels. */
  travelled: number;
  speed: number;
  total: number;
}

const IMPULSE_LENGTH = 46;
const POINTER_RADIUS = 190;

/* A small deterministic PRNG. Fixed seed per field so the artwork is stable. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function build(
  width: number,
  height: number,
  density: number,
): { segments: Segment[]; paths: number[][] } {
  const random = createRandom(0x5eed1e);
  const segments: Segment[] = [];
  const paths: number[][] = [];
  const trunks = Math.max(3, Math.round(density * 6));
  const maxDepth = width < 768 ? 3 : 4;

  const grow = (
    x: number,
    y: number,
    angle: number,
    length: number,
    depth: number,
    lineWidth: number,
    trail: number[],
  ): void => {
    const x2 = x + Math.cos(angle) * length;
    const y2 = y + Math.sin(angle) * length;
    const tip = depth >= maxDepth;
    const index = segments.length;
    segments.push({ x1: x, y1: y, x2, y2, width: lineWidth, length, tip });
    const chain = [...trail, index];

    if (tip) {
      paths.push(chain);
      return;
    }

    const children = random() > 0.72 ? 3 : 2;
    for (let child = 0; child < children; child++) {
      const spread = 0.42 + random() * 0.5;
      const direction = child - (children - 1) / 2;
      grow(
        x2,
        y2,
        angle + direction * spread + (random() - 0.5) * 0.22,
        length * (0.58 + random() * 0.14),
        depth + 1,
        Math.max(0.5, lineWidth * 0.62),
        chain,
      );
    }
  };

  for (let trunk = 0; trunk < trunks; trunk++) {
    /* Anchor trunks just outside the frame so the tree reads as a fragment of
     * something larger rather than a potted plant. */
    const edge = trunk % 2 === 0;
    const start = edge
      ? { x: -width * 0.05, y: height * (0.1 + random() * 0.85) }
      : { x: width * 1.05, y: height * (0.1 + random() * 0.85) };
    const angle = edge
      ? (random() - 0.5) * 1.1
      : Math.PI + (random() - 0.5) * 1.1;
    grow(
      start.x,
      start.y,
      angle,
      Math.min(width, height) * (0.18 + random() * 0.1),
      1,
      2.2,
      [],
    );
  }

  return { segments, paths };
}

function start(canvas: HTMLCanvasElement): void {
  const context = canvas.getContext("2d");
  if (!context) return;

  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const coarse = matchMedia("(pointer: coarse)");
  const density = Number(canvas.dataset.density) || 1;

  let segments: Segment[] = [];
  let paths: number[][] = [];
  let impulses: Impulse[] = [];
  let frame = 0;
  let onScreen = true;
  let pointer: { x: number; y: number } | null = null;
  let myelin = "#78716c";
  let signal = "#a78bfa";
  let synapse = "#d97706";
  let last = 0;

  const readColors = (): void => {
    const styles = getComputedStyle(document.documentElement);
    myelin = styles.getPropertyValue("--myelin").trim() || myelin;
    signal = styles.getPropertyValue("--signal").trim() || signal;
    synapse = styles.getPropertyValue("--synapse").trim() || synapse;
  };

  const seedImpulses = (): void => {
    if (!paths.length) {
      impulses = [];
      return;
    }
    const random = createRandom(0xbeef);
    const count = Math.min(5, Math.max(2, Math.round(density * 4)));
    impulses = Array.from({ length: count }, () => makeImpulse(random));
  };

  const makeImpulse = (random: () => number): Impulse => {
    const path = paths[Math.floor(random() * paths.length)] ?? [];
    const total = path.reduce(
      (sum, index) => sum + (segments[index]?.length ?? 0),
      0,
    );
    return {
      path,
      travelled: -random() * total,
      speed: 55 + random() * 65,
      total,
    };
  };

  const resize = (): void => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const dpr = Math.min(devicePixelRatio, 2);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    ({ segments, paths } = build(rect.width, rect.height, density));
    seedImpulses();
  };

  /* Position along a path at `distance`, plus the segment it falls in. */
  const locate = (
    impulse: Impulse,
    distance: number,
  ): { x: number; y: number } | null => {
    if (distance < 0 || distance > impulse.total) return null;
    let remaining = distance;
    for (const index of impulse.path) {
      const segment = segments[index];
      if (!segment) return null;
      if (remaining <= segment.length) {
        const ratio = segment.length ? remaining / segment.length : 0;
        return {
          x: segment.x1 + (segment.x2 - segment.x1) * ratio,
          y: segment.y1 + (segment.y2 - segment.y1) * ratio,
        };
      }
      remaining -= segment.length;
    }
    return null;
  };

  const paint = (time: number): void => {
    const delta = last ? Math.min((time - last) / 1000, 0.05) : 0;
    last = time;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    context.clearRect(0, 0, width, height);
    context.lineCap = "round";

    for (const segment of segments) {
      const midX = (segment.x1 + segment.x2) / 2;
      const midY = (segment.y1 + segment.y2) / 2;
      /* Local membrane potential: the pointer depolarises nearby tissue. */
      const near = pointer
        ? Math.max(
            0,
            1 - Math.hypot(midX - pointer.x, midY - pointer.y) / POINTER_RADIUS,
          )
        : 0;

      context.globalAlpha = 0.16 + near * 0.5;
      context.strokeStyle = near > 0.25 ? synapse : myelin;
      context.lineWidth = segment.width;
      context.beginPath();
      context.moveTo(segment.x1, segment.y1);
      context.lineTo(segment.x2, segment.y2);
      context.stroke();

      if (segment.tip) {
        context.globalAlpha = 0.3 + near * 0.6;
        context.fillStyle = near > 0.25 ? synapse : myelin;
        context.beginPath();
        context.arc(segment.x2, segment.y2, 1.4 + near * 1.6, 0, Math.PI * 2);
        context.fill();
      }
    }

    if (!reduced.matches) {
      context.strokeStyle = signal;
      context.lineWidth = 1.8;
      for (const impulse of impulses) {
        impulse.travelled += impulse.speed * delta;
        if (impulse.travelled - IMPULSE_LENGTH > impulse.total) {
          impulse.travelled = -IMPULSE_LENGTH;
        }
        /* Sample the impulse as a short polyline so it follows branch turns. */
        const steps = 6;
        for (let step = 0; step < steps; step++) {
          const head = impulse.travelled - (IMPULSE_LENGTH / steps) * step;
          const tail = head - IMPULSE_LENGTH / steps;
          const a = locate(impulse, head);
          const b = locate(impulse, tail);
          if (!a || !b) continue;
          context.globalAlpha = 0.75 * (1 - step / steps);
          context.beginPath();
          context.moveTo(a.x, a.y);
          context.lineTo(b.x, b.y);
          context.stroke();
        }
      }
    }

    context.globalAlpha = 1;
    if (!reduced.matches && onScreen) {
      frame = requestAnimationFrame(paint);
    }
  };

  const play = (): void => {
    cancelAnimationFrame(frame);
    last = 0;
    frame = requestAnimationFrame(paint);
  };

  const pause = (): void => {
    cancelAnimationFrame(frame);
    frame = 0;
  };

  new ResizeObserver(() => {
    resize();
    readColors();
    if (onScreen) play();
  }).observe(canvas);

  new IntersectionObserver(([entry]) => {
    onScreen = Boolean(entry?.isIntersecting);
    if (onScreen) play();
    else pause();
  }).observe(canvas);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pause();
    else if (onScreen) play();
  });

  if (!coarse.matches) {
    const host = canvas.parentElement;
    host?.addEventListener(
      "pointermove",
      (event) => {
        const rect = canvas.getBoundingClientRect();
        pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      },
      { passive: true },
    );
    host?.addEventListener("pointerleave", () => {
      pointer = null;
    });
  }

  readColors();
  resize();
  play();

  document.addEventListener("theme:change", () => {
    readColors();
    if (onScreen) play();
  });
}

for (const canvas of document.querySelectorAll<HTMLCanvasElement>(
  "[data-dendrite-field]",
)) {
  start(canvas);
}
