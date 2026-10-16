import { revealLines, settleIn } from "./primitives";
import { gsap, playWhileVisible, q, qa } from "./runtime";

/* Closing call to action.
 *
 * The page's heartbeat lands here: the line draws flat, then fires, then a
 * pulse keeps travelling it. The step nodes discharge in turn once it beats. */
export function closingStage(): void {
  const closing = q(".closing");
  if (!closing) return;

  revealLines(q("#closing-title", closing));

  const nodes = qa(".closing-steps .synapse-node", closing);
  const live = q<SVGPathElement & HTMLElement>(".pulse-live", closing);
  const run = q<SVGPathElement & HTMLElement>(".pulse-run", closing);
  const wrap = q(".closing-pulse", closing);
  if (!live || !run || !wrap) return;

  /* Armed only now, so without the stage the nodes simply read as charged. */
  for (const node of nodes) node.dataset.charged = "false";

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
        { strokeDashoffset: -1, duration: 2.8, ease: "none" },
      );
      playWhileVisible(wrap, travel);
    },
  });

  timeline.to(live, { strokeDashoffset: 0, duration: 2.4, ease: "none" });

  /* The first beat lands ~48% along the line; the nodes fire with the beats. */
  nodes.forEach((node, index) => {
    timeline.add(
      () => {
        node.dataset.charged = "true";
      },
      1.2 + index * 0.3,
    );
  });

  /* `motion.css` pre-hides the step items; settle them in with the line. */
  settleIn(qa(".closing-steps li", closing), { stagger: 0.12, y: 14 });
}
