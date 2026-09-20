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
    /* Moving forward through the tour should look like the next shot rising
     * into place, and moving back like the previous one returning. A
     * direction-blind cross-fade is what makes this read as a slideshow. */
    const forward = index > previous;
    const travel = forward ? 22 : -22;
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
        scale: 1.015,
        yPercent: -travel * 0.12,
        filter: "blur(7px)",
        duration: 0.4,
        ease: "signal",
      });
    }
    gsap.fromTo(
      incoming,
      {
        opacity: 0,
        scale: 0.985,
        yPercent: travel * 0.12,
        filter: "blur(7px)",
      },
      {
        opacity: 1,
        scale: 1,
        yPercent: 0,
        filter: "blur(0px)",
        duration: 0.55,
        ease: "signal",
        delay: 0.08,
      },
    );
  };

  const media = gsap.matchMedia();

  media.add(DESKTOP, () => {
    const shotsRoot = q(".tour-shots", tour);
    if (shotsRoot) shotsRoot.dataset.shotsLive = "true";
    tour.dataset.railLive = "true";
    setActive(0);
    if (shots[0])
      gsap.set(shots[0], { opacity: 1, scale: 1, filter: "blur(0px)" });

    for (const [index, stop] of stops.entries()) {
      /* Windows that meet rather than leave gaps: between two stops there is
       * always exactly one candidate, so the frame never lags behind the copy
       * the visitor is reading. */
      ScrollTrigger.create({
        trigger: stop,
        start: "top 68%",
        end: "bottom 32%",
        onToggle: (self) => {
          if (self.isActive) setActive(index);
        },
      });

      /* The rail fills with the scroll rather than on the activation step, so
       * the chapter list tracks reading position continuously. */
      gsap.fromTo(
        stop,
        { "--stop-progress": 0 },
        {
          "--stop-progress": 1,
          ease: "none",
          scrollTrigger: {
            trigger: stop,
            start: "top 72%",
            end: "bottom 45%",
            scrub: 0.45,
          },
        },
      );
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
      delete tour.dataset.railLive;
      gsap.set(shots, { clearProps: "opacity,scale,filter,yPercent" });
      gsap.set(stops, { clearProps: "--stop-progress" });
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
