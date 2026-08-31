/* §9 Tuned defaults.
 *
 * The membrane trace reads as a story: steady firing, a flat stretch where the
 * run fails, then a full re-fire. The labels light with the phase the
 * travelling segment is in.
 */

import { drawPath, parallax, revealLines, travelDash } from "./primitives";
import { q } from "./runtime";

export function defaultsStage(): void {
  const defaults = q(".defaults");
  if (!defaults) return;

  /* The cards are `data-reveal-child` inside a staggered `Reveal`, which the
   * generic reveal pass already settles — settling them here too would run the
   * entrance twice. */
  revealLines(q(".history-title", defaults));
  parallax(q(".history-media", defaults), {
    trigger: q(".history", defaults) ?? defaults,
    from: 22,
    to: -22,
    property: "--stage-parallax",
  });

  const trace = q<SVGPathElement>(".trace-live", defaults);
  if (!trace) return;

  const wrap = q(".trace-wrap", defaults);

  drawPath(trace);

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
