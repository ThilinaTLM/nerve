/* Workbench choreography.
 *
 * The component script already makes the hotspots work. This adds what only
 * motion can: a floating phone, a floor reveal, and the
 * panels advance on their own while the section is on screen. Any hover,
 * focus or click hands control to the visitor for good.
 */

import {
  DESKTOP,
  gsap,
  playWhileVisible,
  q,
  qa,
  ScrollTrigger,
} from "./runtime";

const DWELL = 5.5;

export function workbenchStage(): void {
  const root = q("[data-workbench]");
  if (!root) return;

  const count = qa("[data-wb-chip]", root).length;
  if (count < 2) return;

  const stageEl = q(".wb-stage", root);
  const phone = q(".wb-phone", root);
  const floor = q(".wb-floor", root);

  /* Keep the text-bearing desktop frame untransformed so it stays sharp.
   * Only the decorative floor and phone receive scroll choreography. */
  if (stageEl) {
    gsap.matchMedia().add(DESKTOP, () => {
      const scrub = {
        /* The untransformed wrapper: a transformed trigger would move its own
         * start and end while it animates. */
        trigger: root,
        start: "top 92%",
        end: "top 22%",
        scrub: 0.7,
      };
      if (floor) {
        gsap.fromTo(
          floor,
          { opacity: 0.1, scaleX: 0.6 },
          { opacity: 0.6, scaleX: 1, ease: "none", scrollTrigger: scrub },
        );
      }
      if (phone) {
        /* Rises from further back than the device and floats once landed. */
        gsap.fromTo(
          phone,
          { z: -140, y: 90 },
          { z: 0, y: 0, ease: "none", scrollTrigger: scrub },
        );
        const bob = gsap.to(phone, {
          y: -9,
          duration: 4.2,
          ease: "sine.inOut",
          yoyo: true,
          repeat: -1,
          paused: true,
        });
        playWhileVisible(phone, bob);
      }
    });
  }

  /* Auto-advance: a tween drives both the chip progress bar and the step. */
  let index = 0;
  let inView = false;
  let held = false;
  let stopped = false;

  const tween = gsap.fromTo(
    root,
    { "--wb-progress": 0 },
    {
      "--wb-progress": 1,
      duration: DWELL,
      ease: "none",
      paused: true,
      repeat: -1,
      onRepeat: () => {
        index = (index + 1) % count;
        root.dispatchEvent(new CustomEvent("wb:select", { detail: index }));
      },
    },
  );

  const sync = (): void => {
    if (stopped) return;
    if (inView && !held && document.visibilityState === "visible") tween.play();
    else tween.pause();
  };

  ScrollTrigger.create({
    trigger: root,
    start: "top 70%",
    end: "bottom 30%",
    onToggle: (self) => {
      inView = self.isActive;
      sync();
    },
  });
  document.addEventListener("visibilitychange", sync);

  root.setAttribute("data-auto", "");

  const stage = q(".wb-stage", root);
  stage?.addEventListener("pointerenter", () => {
    held = true;
    sync();
  });
  stage?.addEventListener("pointerleave", () => {
    held = false;
    sync();
  });
  root.addEventListener("focusin", () => {
    held = true;
    sync();
  });
  root.addEventListener("focusout", () => {
    held = false;
    sync();
  });

  /* Once the visitor chooses a panel, the tour stays where they put it. */
  root.addEventListener("wb:user", () => {
    stopped = true;
    tween.kill();
    root.removeAttribute("data-auto");
  });
}
