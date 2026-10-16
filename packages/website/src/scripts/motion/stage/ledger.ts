/* Lean harness: three 3D beats.
 *
 * Each beat is a small timeline built by `beatN`. On desktop the three are
 * strung into one pinned, scrubbed scene (beats swap with a depth turn); on
 * small screens each plays once when it scrolls in, with lighter 3D. The
 * authored DOM is the complete static picture; everything here only changes
 * presentation (transform / opacity).
 */

import { COMPACT, DESKTOP, gsap, q, qa, ScrollTrigger } from "./runtime";

const VIEWPORTS = 2.3;

function count(
  beat: HTMLElement,
  tl: gsap.core.Timeline,
  at: number,
  duration: number,
): void {
  const el = q<HTMLElement>("[data-ledger-n]", beat);
  if (!el) return;
  const target = Number(el.dataset.ledgerN);
  const proxy = { n: 0 };
  tl.to(
    proxy,
    {
      n: target,
      duration,
      ease: "power2.out",
      onUpdate: () => {
        el.textContent = String(Math.round(proxy.n));
      },
    },
    at,
  );
}

function beat1(beat: HTMLElement, depth: number): gsap.core.Timeline {
  const tl = gsap.timeline();
  const pages = qa("[data-ledger-page]", beat);
  const prompt = q("[data-ledger-prompt]", beat);
  const glow = q(".ledger-glow", beat);

  tl.from(q(".ledger-world", beat), {
    rotateY: 38,
    rotateX: 16,
    scale: 0.85,
    opacity: 0,
    duration: 1.1,
    ease: "settle",
  });
  tl.from(
    pages,
    {
      z: -420 * depth,
      y: 60,
      opacity: 0,
      stagger: 0.07,
      duration: 0.8,
      ease: "settle",
    },
    0.1,
  );
  if (prompt) {
    tl.from(
      prompt,
      {
        z: 380 * depth,
        y: 40,
        opacity: 0,
        scale: 0.8,
        duration: 0.9,
        ease: "back.out(1.6)",
      },
      0.7,
    );
  }
  if (glow) {
    tl.fromTo(
      glow,
      { opacity: 0.2 },
      { opacity: 0.8, duration: 0.5, yoyo: true, repeat: 1 },
      1.4,
    );
  }
  count(beat, tl, 0, 1.2);
  return tl;
}

function beat2(beat: HTMLElement, depth: number): gsap.core.Timeline {
  const tl = gsap.timeline();
  const tiles = qa("[data-ledger-tile]", beat);
  const unused = qa("[data-ledger-unused]", beat);

  tl.from(q(".ledger-world", beat), {
    rotateX: 40,
    y: 40,
    opacity: 0,
    duration: 0.8,
    ease: "settle",
  });
  tl.from(
    tiles,
    {
      rotateY: -100,
      z: -120 * depth,
      opacity: 0,
      stagger: 0.045,
      duration: 0.6,
      ease: "back.out(1.4)",
    },
    0.2,
  );
  tl.from(
    unused,
    { rotateX: -90, y: -20, opacity: 0, stagger: 0.08, duration: 0.5 },
    1.3,
  );
  /* The tools this run cannot use sink away — they are never sent. */
  tl.to(
    unused,
    {
      rotateX: 55,
      y: 14,
      opacity: 0.18,
      stagger: 0.08,
      duration: 0.7,
      ease: "power2.in",
    },
    2,
  );
  tl.from(q(".ledger-unused-note", beat), { opacity: 0, duration: 0.4 }, 2.4);
  count(beat, tl, 0.1, 1.2);
  return tl;
}

function beat3(beat: HTMLElement, depth: number): gsap.core.Timeline {
  const tl = gsap.timeline();
  const sheet = q("[data-ledger-sheet]", beat);
  const folds = qa("[data-ledger-fold]", beat);
  const model = q("[data-ledger-model]", beat);
  const drawer = q("[data-ledger-drawer]", beat);
  const stored = q("[data-ledger-stored]", beat);
  if (!sheet || !model || !drawer || !stored) return tl;

  tl.from(drawer, { x: 60, opacity: 0, duration: 0.6, ease: "settle" }, 0);
  tl.from(
    sheet,
    {
      y: -170,
      z: 300 * depth,
      rotateX: -55,
      opacity: 0,
      duration: 0.9,
      ease: "settle",
    },
    0,
  );

  /* Accordion fold: alternating panels hinge shut while the sheet collapses. */
  folds.forEach((fold, i) => {
    tl.to(
      fold,
      {
        rotateX: i % 2 ? -72 : 72,
        transformOrigin: i % 2 ? "50% 0%" : "50% 100%",
        duration: 0.7,
        ease: "power2.inOut",
      },
      1.2 + i * 0.05,
    );
  });
  tl.to(
    sheet,
    {
      scaleY: 0.3,
      transformOrigin: "50% 50%",
      duration: 0.8,
      ease: "power3.inOut",
    },
    1.3,
  );
  tl.from(
    model,
    {
      scale: 0.4,
      z: -160 * depth,
      opacity: 0,
      duration: 0.7,
      ease: "back.out(1.7)",
    },
    1.8,
  );

  /* The full output slides into the archive drawer. */
  tl.from(stored, { x: -120, opacity: 0, duration: 0.7, ease: "settle" }, 2.2);
  tl.to(
    sheet,
    {
      x: depth < 1 ? 0 : 90,
      opacity: depth < 1 ? 0.3 : 0,
      duration: 0.6,
      ease: "power2.in",
    },
    2.2,
  );
  count(beat, tl, 1.5, 0.8);
  return tl;
}

export function ledgerStage(): void {
  const root = q("[data-ledger]");
  if (!root) return;

  const stage = q("[data-ledger-stage]", root);
  const beats = qa("[data-ledger-beat]", root);
  if (!stage || beats.length !== 3) return;

  const builders = [beat1, beat2, beat3];
  const media = gsap.matchMedia();

  media.add(COMPACT, () => {
    beats.forEach((beat, i) => {
      const tl = builders[i]!(beat, 0.4).pause();
      ScrollTrigger.create({
        trigger: beat,
        start: "top 78%",
        once: true,
        onEnter: () => void tl.play(),
      });
    });
  });

  media.add(DESKTOP, () => {
    root.dataset.pinned = "true";

    const [b1, b2, b3] = beats as [HTMLElement, HTMLElement, HTMLElement];
    gsap.set([b2, b3], { autoAlpha: 0 });

    const tl = gsap.timeline({ defaults: { ease: "none" } });
    const swap = (from: HTMLElement, to: HTMLElement, at: number): void => {
      tl.to(
        from,
        {
          autoAlpha: 0,
          rotateY: 28,
          z: -260,
          transformPerspective: 1400,
          duration: 0.7,
          ease: "power2.in",
        },
        at,
      );
      tl.fromTo(
        to,
        { autoAlpha: 0, rotateY: -28, z: -260, transformPerspective: 1400 },
        { autoAlpha: 1, rotateY: 0, z: 0, duration: 0.7, ease: "power2.out" },
        at + 0.5,
      );
    };

    tl.add(builders[0]!(b1, 1), 0);
    swap(b1, b2, 3.4);
    tl.add(builders[1]!(b2, 1), 3.9);
    swap(b2, b3, 7.4);
    tl.add(builders[2]!(b3, 1), 7.9);
    tl.to({}, { duration: 1.2 }); // hold on the last beat

    ScrollTrigger.create({
      trigger: stage,
      start: "center center+=24",
      end: () => `+=${Math.round(window.innerHeight * VIEWPORTS)}`,
      pin: true,
      anticipatePin: 1,
      invalidateOnRefresh: true,
      scrub: 0.6,
      animation: tl,
    });

    return () => {
      delete root.dataset.pinned;
    };
  });
}
