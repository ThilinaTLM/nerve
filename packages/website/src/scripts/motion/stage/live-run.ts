/* §3 Live run — one transcript panel, four beats.
 *
 * On desktop the four authored panels become one pinned panel in perspective:
 * a scrubbed timeline moves between beats in depth while a step rail advances.
 * Beat 1 plays on arrival (time-based) so the pinned panel is never empty;
 * beats 2-4 are scrubbed. Every state change is a reversible transform or
 * opacity tween, so scrolling back undoes the run. Pointer tilt comes from
 * tilt.ts through `--tilt-*` on `.tilt-target`. Below desktop the stacked
 * panels only tip up out of depth as they arrive.
 */

import { COMPACT, DESKTOP, gsap, q, qa, ScrollTrigger } from "./runtime";

/* Timeline length in abstract units; the pin length is derived from it. */
const TOTAL = 3.9;
/* Where the rail considers each beat to start, and where a click jumps to. */
const SWITCH = [0.75, 1.75, 2.75];
const JUMP = [0.3, 1.5, 2.55, 3.6];
const VIEWPORTS_PER_RUN = 2.8;

/* Rows start receded and tipped back; they rise forward into place. */
const DEEP = { autoAlpha: 0, y: 14, z: -70, rotateX: -10 };
const SETTLED = { autoAlpha: 1, y: 0, z: 0, rotateX: 0 };

export function liveRunStage(): void {
  const root = q("[data-live-run]");
  if (!root) return;

  const beats = qa("[data-lr-beat]", root);
  const steps = qa<HTMLAnchorElement>("[data-lr-step]", root);
  if (beats.length !== 4 || steps.length !== 4) return;

  const media = gsap.matchMedia();

  /* Stacked view: light entrance depth only. */
  media.add(COMPACT, () => {
    for (const beat of beats) {
      ScrollTrigger.create({
        trigger: beat,
        start: "top 90%",
        once: true,
        onEnter: () =>
          void gsap.from(beat, {
            opacity: 0,
            y: 30,
            z: -50,
            rotateX: 7,
            transformPerspective: 900,
            transformOrigin: "50% 100%",
            duration: 0.8,
            clearProps: "transform,opacity",
          }),
      });
    }
  });

  media.add(DESKTOP, () => {
    root.dataset.pinned = "true";

    /* Depth: a perspective container, pointer tilt driven by tilt.ts, and a
     * scrubbed rotation on the panel itself. */
    const stage3d = q("[data-lr-3d]", root);
    const tiltEl = q(".lr-tilt", root);
    const panel = q("[data-lr-panel]", root);
    const composer = q(".lr-composer", root);
    const hint = q(".lr-hint", root);
    stage3d?.classList.add("stage-3d");
    tiltEl?.classList.add("tilt-target");

    const offsetWithin = (el: HTMLElement, ancestor: HTMLElement): number => {
      let y = 0;
      let node: HTMLElement | null = el;
      while (node && node !== ancestor) {
        y += node.offsetTop;
        node = node.offsetParent as HTMLElement | null;
      }
      return y;
    };

    const [b1, b2, b3, b4] = beats as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];
    const rows = (beat: HTMLElement): HTMLElement[] =>
      qa("[data-lr-row]", beat);

    /* ---- Initial states -------------------------------------------------- */

    gsap.set([b2, b3, b4], { autoAlpha: 0 });
    if (panel)
      gsap.set(panel, { rotateY: -9, rotateX: 5, transformOrigin: "30% 50%" });

    const r1 = rows(b1);
    const outLines = qa("[data-lr-out-line]", b1);
    const foot = q("[data-lr-foot]", b1);
    gsap.set(r1, DEEP);
    gsap.set(outLines, { autoAlpha: 0, x: -6 });
    if (foot) gsap.set(foot, { autoAlpha: 0, y: 6 });

    const [toolRow, steerRow, configRow, replyRow] = rows(b2) as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];
    gsap.set([toolRow, configRow, replyRow], DEEP);
    gsap.set(steerRow, { autoAlpha: 0 });

    const modelFrom = q("[data-lr-model-from]", root);
    const modelTo = q("[data-lr-model-to]", root);
    const perm = q("[data-lr-perm]", root);

    const [policyRow, gateRow, editRow] = rows(b3) as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];
    const pills = qa("[data-lr-pill]", b3);
    const activePill = pills.find((pill) => pill.hasAttribute("data-active"));
    const scanPills = pills.filter((pill) => pill !== activePill);
    const tint = q(".lr-gate-tint", gateRow);
    const dot = q(".run-gate-dot", gateRow);
    const approve = q("[data-lr-approve]", gateRow);
    const ok = q("[data-lr-ok]", gateRow);
    const diff = qa("[data-lr-diff]", editRow);
    gsap.set([policyRow, gateRow], DEEP);
    gsap.set(editRow, { ...DEEP, z: -90 });
    gsap.set(diff, { autoAlpha: 0, x: -6 });
    gsap.set(scanPills, { opacity: 0.35 });

    const ring = q<SVGCircleElement>("[data-lr-ring]", b4);
    const branch = q<SVGPathElement>("[data-lr-branch]", b4);
    const newNodes = qa<SVGCircleElement>("[data-lr-new]", b4);
    const newLabels = qa("[data-lr-new-label]", b4);
    const oldLayer = q("[data-lr-layer='old']", b4);
    const frontLayer = q("[data-lr-layer='front']", b4);
    const treeRot = q("[data-lr-tree-rot]", b4);
    const detail = q("[data-lr-detail]", b4);
    const branchLength = branch?.getTotalLength() ?? 0;

    if (ring) gsap.set(ring, { attr: { cy: 218 }, opacity: 0.55 });
    if (branch)
      gsap.set(branch, {
        strokeDasharray: branchLength,
        strokeDashoffset: branchLength,
      });
    gsap.set(newNodes, { attr: { r: 0 } });
    gsap.set(newLabels, { autoAlpha: 0, x: -6 });
    if (detail) gsap.set(detail, { autoAlpha: 0, x: 14, z: -60, rotateY: 14 });

    /* ---- Beat 1: plays on arrival --------------------------------------- */

    const intro = gsap.timeline({ paused: true });
    intro
      .to(r1, { ...SETTLED, duration: 0.7, stagger: 0.28, ease: "settle" }, 0.1)
      .to(outLines, { autoAlpha: 1, x: 0, duration: 0.4, stagger: 0.09 }, 0.95)
      .to(foot ?? [], { autoAlpha: 1, y: 0, duration: 0.5 }, 1.5);

    ScrollTrigger.create({
      trigger: root,
      start: "top 78%",
      once: true,
      onEnter: () => void intro.play(),
    });

    /* ---- Beats 2-4: scrubbed -------------------------------------------- */

    const tl = gsap.timeline({ defaults: { ease: "none" } });

    /* The panel's tilt eases toward flat as the story advances. */
    if (panel) tl.to(panel, { rotateY: -2, rotateX: 1, duration: TOTAL }, 0);

    /* The outgoing beat tips back and recedes; the incoming one rises
     * forward out of the depth. */
    const handOver = (from: HTMLElement, to: HTMLElement, at: number): void => {
      tl.to(
        from,
        {
          autoAlpha: 0,
          y: -26,
          z: -160,
          rotateX: 14,
          transformOrigin: "50% 0%",
          duration: 0.12,
        },
        at,
      );
      tl.fromTo(
        to,
        {
          autoAlpha: 0,
          y: 34,
          z: 120,
          rotateX: -10,
          transformOrigin: "50% 100%",
        },
        { ...SETTLED, duration: 0.12 },
        at + 0.05,
      );
    };

    const rowIn = { ...SETTLED, duration: 0.12 };

    /* 2 · Steer mid-run */
    handOver(b1, b2, 0.7);
    let t = 0.85;
    tl.to(toolRow, rowIn, t);

    /* The steering message leaves the composer and travels up into the
     * stream, growing out of the depth. */
    tl.fromTo(
      steerRow,
      {
        y: () =>
          composer && panel
            ? offsetWithin(composer, panel) -
              offsetWithin(steerRow, panel) -
              offsetWithin(b2, panel)
            : 90,
        z: 80,
        scale: 0.86,
        autoAlpha: 0,
      },
      {
        y: 0,
        z: 0,
        scale: 1,
        autoAlpha: 1,
        duration: 0.24,
        ease: "power3.out",
      },
      t + 0.16,
    );
    if (hint) {
      tl.to(hint, { opacity: 0.35, duration: 0.05 }, t + 0.14);
      tl.to(hint, { opacity: 1, duration: 0.1 }, t + 0.34);
    }
    tl.to(configRow, rowIn, t + 0.42);
    if (modelFrom && modelTo) {
      tl.to(modelFrom, { autoAlpha: 0, y: -6, duration: 0.08 }, t + 0.44);
      tl.fromTo(
        modelTo,
        { autoAlpha: 0, y: 6 },
        { autoAlpha: 1, y: 0, duration: 0.08 },
        t + 0.46,
      );
    }
    tl.to(replyRow, rowIn, t + 0.62);

    /* 3 · The gate is real */
    handOver(b2, b3, 1.7);
    t = 1.85;
    tl.to(policyRow, rowIn, t);
    scanPills.forEach((pill, index) => {
      const at = t + 0.12 + index * 0.1;
      tl.to(pill, { opacity: 1, duration: 0.04 }, at);
      tl.to(pill, { opacity: 0.35, duration: 0.05 }, at + 0.07);
    });
    if (activePill)
      tl.to(
        activePill,
        { scale: 1.04, duration: 0.05, yoyo: true, repeat: 1 },
        t + 0.34,
      );
    if (perm)
      tl.to(
        perm,
        { scale: 1.1, duration: 0.05, yoyo: true, repeat: 1 },
        t + 0.34,
      );

    /* The gate arrives forward in Z, pushing the policy row back, and holds
     * there until it is answered; approving snaps it home. */
    tl.to(
      gateRow,
      {
        ...SETTLED,
        z: 26,
        duration: 0.12,
        ease: "power2.out",
      },
      t + 0.3,
    );
    tl.to(policyRow, { z: -50, opacity: 0.6, duration: 0.12 }, t + 0.3);
    if (approve)
      tl.to(
        approve,
        { scale: 0.92, duration: 0.04, yoyo: true, repeat: 1 },
        t + 0.48,
      );
    tl.to(
      gateRow,
      { z: 0, scale: 1, duration: 0.1, ease: "back.out(3)" },
      t + 0.54,
    );
    tl.to(policyRow, { z: 0, opacity: 1, duration: 0.1 }, t + 0.54);
    if (tint) tl.to(tint, { opacity: 1, duration: 0.06 }, t + 0.54);
    if (dot) tl.to(dot, { opacity: 0, duration: 0.04 }, t + 0.54);
    if (approve) tl.to(approve, { autoAlpha: 0, duration: 0.05 }, t + 0.54);
    if (ok) tl.to(ok, { opacity: 1, duration: 0.05 }, t + 0.56);
    tl.to(editRow, { ...rowIn, ease: "power2.out" }, t + 0.62);
    tl.to(diff, { autoAlpha: 1, x: 0, duration: 0.06, stagger: 0.05 }, t + 0.7);

    /* 4 · Rewind and branch */
    handOver(b3, b4, 2.7);
    t = 2.85;
    if (ring) {
      tl.to(
        ring,
        { attr: { cy: 90 }, opacity: 1, duration: 0.3, ease: "power2.inOut" },
        t + 0.05,
      );
    }
    /* The tree turns to show depth: the old lineage falls back and dims while
     * the shared trunk and the new branch come forward. */
    if (treeRot)
      tl.to(
        treeRot,
        { rotateY: -12, rotateX: 5, duration: 0.5, ease: "power2.inOut" },
        t + 0.3,
      );
    if (oldLayer)
      tl.to(
        oldLayer,
        { z: -90, x: -34, opacity: 0.5, duration: 0.3 },
        t + 0.38,
      );
    if (frontLayer) tl.to(frontLayer, { z: 30, duration: 0.3 }, t + 0.38);
    if (detail)
      tl.to(
        detail,
        { autoAlpha: 1, x: 0, z: 0, rotateY: 0, duration: 0.16 },
        t + 0.3,
      );
    if (branch)
      tl.to(branch, { strokeDashoffset: 0, duration: 0.25 }, t + 0.45);
    tl.to(
      newNodes,
      { attr: { r: 5 }, duration: 0.08, stagger: 0.1, ease: "back.out(2)" },
      t + 0.62,
    );
    tl.to(
      newLabels,
      { autoAlpha: 1, x: 0, duration: 0.08, stagger: 0.1 },
      t + 0.66,
    );

    if (tl.duration() < TOTAL) tl.to({}, { duration: TOTAL - tl.duration() });

    /* ---- Pin + rail ----------------------------------------------------- */

    let current = -1;
    const setStep = (index: number): void => {
      if (index === current) return;
      current = index;
      for (const [position, step] of steps.entries()) {
        if (position === index) step.setAttribute("aria-current", "step");
        else step.removeAttribute("aria-current");
      }
    };
    setStep(0);

    const trigger = ScrollTrigger.create({
      trigger: root,
      start: "center center+=32",
      end: () => `+=${Math.round(window.innerHeight * VIEWPORTS_PER_RUN)}`,
      pin: true,
      anticipatePin: 1,
      invalidateOnRefresh: true,
      scrub: 0.6,
      animation: tl,
      onUpdate: (self) => {
        const time = self.progress * TOTAL;
        setStep(SWITCH.filter((mark) => time >= mark).length);
        root.style.setProperty("--lr-progress", String(self.progress));
      },
    });

    const onClick = (event: Event, index: number): void => {
      event.preventDefault();
      const span = trigger.end - trigger.start;
      window.scrollTo({
        top: trigger.start + (JUMP[index]! / TOTAL) * span,
        behavior: "smooth",
      });
    };
    const handlers = steps.map((step, index) => {
      const handler = (event: Event): void => onClick(event, index);
      step.addEventListener("click", handler);
      return handler;
    });

    return () => {
      steps.forEach((step, index) =>
        step.removeEventListener("click", handlers[index]!),
      );
      delete root.dataset.pinned;
      stage3d?.classList.remove("stage-3d");
      tiltEl?.classList.remove("tilt-target");
      root.style.removeProperty("--lr-progress");
      for (const [position, step] of steps.entries()) {
        if (position === 0) step.setAttribute("aria-current", "step");
        else step.removeAttribute("aria-current");
      }
    };
  });
}
