import { revealLines, settleIn } from "./primitives";
import { gsap, playWhileVisible, q, qa } from "./runtime";

/* Closing call to action.
 *
 * The page's heartbeat lands here: the line draws flat, then fires, then a
 * pulse keeps travelling it. The step row settles in beneath. */
export function closingStage(): void {
  const closing = q(".closing");
  if (!closing) return;

  revealLines(q("#closing-title", closing));

  const live = q<SVGPathElement & HTMLElement>(".pulse-live", closing);
  const run = q<SVGPathElement & HTMLElement>(".pulse-run", closing);
  const wrap = q(".closing-pulse", closing);
  if (!live || !run || !wrap) return;

  gsap.set(live, { strokeDasharray: 1, strokeDashoffset: 1 });

  const timeline = gsap.timeline({
    scrollTrigger: { trigger: wrap, start: "top 88%", once: true },
    onComplete: () => {
      gsap.set(live, { clearProps: "strokeDasharray,strokeDashoffset" });
      /* Path lengths are normalised (pathLength="1"), so a 0.08 dash is 8%. */
      const travel = gsap.timeline({
        repeat: -1,
        repeatDelay: 0.8,
        paused: true,
      });
      travel.fromTo(
        run,
        { opacity: 1, strokeDasharray: "0.08 2", strokeDashoffset: 0.08 },
        { strokeDashoffset: -1, duration: 2.4, ease: "none" },
      );
      playWhileVisible(wrap, travel);
    },
  });

  timeline.to(live, { strokeDashoffset: 0, duration: 1.6, ease: "none" });

  /* `motion.css` pre-hides the step items; settle them in after the beat. */
  settleIn(qa(".closing-steps li", closing), { stagger: 0.1, y: 10 });
}
