/* The remaining landing-page sections: the fact strip, the authority dial, the
 * pocket workbench, and the closing call to action.
 */

import { drift, magnetic, revealLines, settleIn } from "./primitives";
import { gsap, playWhileVisible, q, qa } from "./runtime";

/* §2 Signal strip ----------------------------------------------------------
 *
 * One impulse sweeps the axon and each node flashes as it passes. Previously
 * the sweep and the flashes were independent CSS loops with hand-tuned delays,
 * so they drifted apart within a few cycles; now the node state is read from
 * the sweep's own position. */
export function signalStripStage(): void {
  const strip = q(".signal-strip");
  if (!strip) return;

  const axon = q(".strip-axon", strip);
  const sweep = q(".strip-sweep", strip);
  const nodes = qa(".synapse-node", strip);
  if (!axon || !sweep) return;

  const centres = (): number[] => {
    const origin = axon.getBoundingClientRect().left;
    return nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return rect.left + rect.width / 2 - origin;
    });
  };

  let positions = centres();
  const remeasure = (): void => {
    positions = centres();
  };
  window.addEventListener("resize", remeasure, { passive: true });

  const timeline = gsap.timeline({
    repeat: -1,
    repeatDelay: 1.4,
    paused: true,
  });
  timeline.fromTo(
    sweep,
    { x: -140, opacity: 0 },
    {
      x: () => axon.clientWidth + 140,
      opacity: 1,
      duration: 3.6,
      ease: "none",
      onUpdate: () => {
        const head = (gsap.getProperty(sweep, "x") as number) + 48;
        for (const [index, node] of nodes.entries()) {
          const centre = positions[index] ?? 0;
          const lit = head >= centre && head < centre + 90;
          if ((node.dataset.charged === "true") !== lit) {
            node.dataset.charged = String(lit);
          }
        }
      },
    },
  );

  playWhileVisible(strip, timeline);
}

/* §4 Authority dial --------------------------------------------------------
 *
 * The dial itself is deliberately script-free: `:has()` on the radios is the
 * source of truth, and the row-staggered matrix swap is a CSS animation. The
 * stage adds only the charge sweep up the dial column, which needs to know
 * which stop was chosen. */
export function authorityStage(): void {
  const dial = q(".authority");
  if (!dial) return;

  const axon = q(".dial-axon", dial);
  const inputs = qa<HTMLInputElement>(".dial-stop input", dial);
  if (!axon || !inputs.length) return;

  for (const input of inputs) {
    input.addEventListener("change", () => {
      gsap.fromTo(
        axon,
        { "--charge-sweep": 0, "--sweep-alpha": 1 },
        {
          "--charge-sweep": 1,
          "--sweep-alpha": 0,
          duration: 0.62,
          ease: "signal",
          overwrite: true,
        },
      );
    });
  }
}

/* §8 Pocket workbench ------------------------------------------------------ */
export function pocketStage(): void {
  const pocket = q("[data-pocket]");
  if (!pocket) return;

  revealLines(q(".pocket-copy .section-title", pocket));

  const media = gsap.matchMedia();

  /* The arc only exists once the phones sit side by side. */
  media.add("(min-width: 768px)", () => {
    const slots = qa(".arc-slot", pocket);
    if (!slots.length) return;

    pocket.dataset.arcReady = "true";

    gsap.fromTo(
      pocket,
      { "--arc-open": 0 },
      {
        "--arc-open": 1,
        duration: 1,
        ease: "settle",
        scrollTrigger: { trigger: pocket, start: "top 78%", once: true },
        onComplete: () =>
          drift(slots, { amount: 9, base: 8.5, property: "--slot-float" }),
      },
    );

    return () => {
      delete pocket.dataset.arcReady;
      gsap.set(pocket, { clearProps: "--arc-open" });
      gsap.set(slots, { clearProps: "--slot-float" });
    };
  });
}

/* §11 Closing call to action ----------------------------------------------- */
export function closingStage(): void {
  const closing = q(".closing");
  if (!closing) return;

  revealLines(q("#closing-title", closing));
  settleIn(qa(".closing-steps li", closing), { stagger: 0.08, y: 16 });

  /* The terminal bouton fires once into the call to action. */
  const lead = q(".closing-lead", closing);
  if (lead) {
    const discharge = document.createElement("span");
    discharge.className = "closing-discharge";
    discharge.setAttribute("aria-hidden", "true");
    lead.append(discharge);

    gsap.fromTo(
      discharge,
      { opacity: 0.9, scale: 0.4 },
      {
        opacity: 0,
        scale: 3.6,
        duration: 1.1,
        ease: "signal",
        scrollTrigger: { trigger: closing, start: "top 72%", once: true },
      },
    );
  }

  magnetic(qa<HTMLElement>("[data-magnetic]", closing));
}
