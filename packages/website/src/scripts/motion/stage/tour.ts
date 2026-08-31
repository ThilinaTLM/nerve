/* §5 Workbench tour.
 *
 * The media column is pinned by CSS; the copy column decides which shot is on
 * screen. Four triggers rather than one observer, so the active stop is derived
 * from the same scroll position the frame is reacting to.
 */

import { parallax, revealLines, settleIn } from "./primitives";
import { DESKTOP, gsap, q, qa, ScrollTrigger } from "./runtime";

export function tourStage(): void {
  const tour = q("[data-tour]");
  if (!tour) return;

  const stops = qa("[data-tour-stop]", tour);
  const shots = qa(".tour-shot", tour);
  if (!stops.length) return;

  const setActive = (index: number): void => {
    if (tour.dataset.active === String(index)) return;

    const previous = Number(tour.dataset.active ?? 0);
    tour.dataset.active = String(index);
    for (const [position, stop] of stops.entries()) {
      stop.dataset.stopActive = String(position === index);
    }

    const incoming = shots[index];
    const outgoing = shots[previous];
    if (!incoming || incoming === outgoing) return;

    /* A short defocus on the way out reads as attention moving, where a plain
     * cross-fade reads as a slideshow. */
    if (outgoing) {
      gsap.to(outgoing, {
        opacity: 0,
        scale: 1.02,
        filter: "blur(6px)",
        duration: 0.45,
        ease: "signal",
      });
    }
    gsap.fromTo(
      incoming,
      { opacity: 0, scale: 1.02, filter: "blur(6px)" },
      {
        opacity: 1,
        scale: 1,
        filter: "blur(0px)",
        duration: 0.45,
        ease: "signal",
        delay: 0.1,
      },
    );
  };

  const media = gsap.matchMedia();

  media.add(DESKTOP, () => {
    const shotsRoot = q(".tour-shots", tour);
    if (shotsRoot) shotsRoot.dataset.shotsLive = "true";
    setActive(0);
    if (shots[0])
      gsap.set(shots[0], { opacity: 1, scale: 1, filter: "blur(0px)" });

    for (const [index, stop] of stops.entries()) {
      ScrollTrigger.create({
        trigger: stop,
        start: "top 62%",
        end: "bottom 38%",
        onToggle: (self) => {
          if (self.isActive) setActive(index);
        },
      });
    }

    const frame = q(".tour-frame", tour);
    if (frame) {
      parallax(frame, { trigger: tour, from: 18, to: -18 });
      gsap.fromTo(
        frame,
        { "--stage-rotate": "1.5deg" },
        {
          "--stage-rotate": "-1.5deg",
          ease: "none",
          scrollTrigger: {
            trigger: tour,
            start: "top bottom",
            end: "bottom top",
            scrub: 0.6,
          },
        },
      );
    }

    return () => {
      if (shotsRoot) delete shotsRoot.dataset.shotsLive;
      gsap.set(shots, { clearProps: "opacity,scale,filter" });
    };
  });

  for (const stop of stops) {
    revealLines(q(".tour-title", stop), { start: "top 86%" });
    settleIn(qa(".tour-points li", stop), {
      stagger: 0.08,
      y: 12,
      start: "top 92%",
    });
  }
}
