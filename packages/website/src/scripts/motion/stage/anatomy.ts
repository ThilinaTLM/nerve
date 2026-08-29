/* §4 Event anatomy.
 *
 * Unpinned on purpose: the conduction rail scrubs with scroll and the rows
 * arrive as the rail reaches them, so the section is a pure function of scroll
 * position and reads identically on desktop and touch. The authored state is
 * fully drawn and fully visible.
 */

import { settleIn } from "./primitives";
import { gsap, q, qa } from "./runtime";

export function anatomyStage(): void {
  const anatomy = q("[data-anatomy]");
  if (!anatomy) return;

  const rail = q("[data-anatomy-rail]", anatomy);
  const stack = q(".anatomy-stack", anatomy);
  const rows = qa("[data-anatomy-row]", anatomy);

  if (rail && stack) {
    gsap.fromTo(
      rail,
      { "--rail-progress": 0 },
      {
        "--rail-progress": 1,
        ease: "none",
        scrollTrigger: {
          trigger: stack,
          start: "top 78%",
          end: "bottom 55%",
          scrub: 0.5,
        },
      },
    );
  }

  settleIn(rows, { stagger: 0.08, y: 20, start: "top 86%" });
}
