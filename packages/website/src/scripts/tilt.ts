/* Shared pointer-tilt and spotlight controller.
 *
 * One document-level pointer listener drives every `[data-tilt]` element, so a
 * page with a dozen tilting cards still costs a single event subscription and a
 * single rAF per frame. Rectangles are cached and invalidated on scroll and
 * resize rather than measured per pointer move.
 *
 * Writes two custom properties consumed by `.tilt-target` in `neural.css`:
 *   --tilt-x / --tilt-y   rotation in degrees
 *
 * With no script, a coarse pointer, or reduced motion, both stay unset and the
 * element renders flat. Nothing here is required for the page to read.
 */

interface TiltTarget {
  element: HTMLElement;
  max: number;
  rect: DOMRect | null;
  /* Current and target rotations, in degrees. */
  x: number;
  y: number;
  toX: number;
  toY: number;
}

const SETTLE = 0.14;
const EPSILON = 0.01;

export function initTilt(): void {
  if (
    matchMedia("(prefers-reduced-motion: reduce)").matches ||
    matchMedia("(pointer: coarse)").matches
  ) {
    return;
  }

  const elements = document.querySelectorAll<HTMLElement>("[data-tilt]");
  if (!elements.length) return;

  const targets: TiltTarget[] = [...elements].map((element) => ({
    element,
    max: Number(element.dataset.tiltMax) || 5,
    rect: null,
    x: 0,
    y: 0,
    toX: 0,
    toY: 0,
  }));

  let pointerX = 0;
  let pointerY = 0;
  let hasPointer = false;
  let animating = false;
  let measureFrame = 0;

  const invalidate = (): void => {
    for (const target of targets) target.rect = null;
  };

  const measure = (target: TiltTarget): DOMRect => {
    target.rect ??= target.element.getBoundingClientRect();
    return target.rect;
  };

  const tick = (): void => {
    animating = false;
    let settled = true;

    for (const target of targets) {
      if (hasPointer) {
        const rect = measure(target);
        if (rect.width && rect.height) {
          /* -1..1 from the element centre, clamped so a pointer far outside the
           * element does not push the tilt past its ceiling. */
          const dx = clamp(
            ((pointerX - rect.left) / rect.width - 0.5) * 2,
            -1,
            1,
          );
          const dy = clamp(
            ((pointerY - rect.top) / rect.height - 0.5) * 2,
            -1,
            1,
          );
          target.toY = dx * target.max;
          target.toX = -dy * target.max;
        }
      } else {
        target.toX = 0;
        target.toY = 0;
      }

      target.x += (target.toX - target.x) * SETTLE;
      target.y += (target.toY - target.y) * SETTLE;

      if (
        Math.abs(target.toX - target.x) > EPSILON ||
        Math.abs(target.toY - target.y) > EPSILON
      ) {
        settled = false;
      }

      target.element.style.setProperty("--tilt-x", `${target.x.toFixed(3)}deg`);
      target.element.style.setProperty("--tilt-y", `${target.y.toFixed(3)}deg`);
    }

    if (!settled) schedule();
  };

  const schedule = (): void => {
    if (animating) return;
    animating = true;
    requestAnimationFrame(tick);
  };

  document.addEventListener(
    "pointermove",
    (event) => {
      if (event.pointerType === "touch") return;
      pointerX = event.clientX;
      pointerY = event.clientY;
      hasPointer = true;
      schedule();
    },
    { passive: true },
  );

  document.addEventListener("pointerleave", () => {
    hasPointer = false;
    schedule();
  });

  const scheduleInvalidate = (): void => {
    if (measureFrame) return;
    measureFrame = requestAnimationFrame(() => {
      measureFrame = 0;
      invalidate();
    });
  };

  addEventListener("scroll", scheduleInvalidate, { passive: true });
  addEventListener("resize", scheduleInvalidate);
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
