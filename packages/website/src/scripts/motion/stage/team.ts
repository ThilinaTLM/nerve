/* Parallel team: replays one delegation as a loop.
 *
 * The authored DOM is the finished run (every agent done, 4/4 reported). The
 * timeline resets it to "queued", sends assignments outward along the wires,
 * lets agents run, returns reports, then sends a follow-up to a name that
 * already exists. Only presentation changes; the text stays readable. */

import { drawPath } from "./primitives";
import { DESKTOP, gsap, jitter, playWhileVisible, q, qa } from "./runtime";

const NS = "http://www.w3.org/2000/svg";
const SEND = 0.85;

type AgentState = "queued" | "running" | "done";

export function teamStage(): void {
  const root = q("[data-team]");
  const svg = root ? q<SVGSVGElement>(".team-wires", root) : null;
  if (!root || !svg) return;

  const agents = qa("[data-agent]", root);
  const taskChip = q("[data-task]", root);
  const lanePath = q<SVGPathElement>('[data-wire="lane"]', svg);
  const countEl = q("[data-lead-count]", root);
  const statusEl = q("[data-lead-status]", root);
  const follow = q("[data-follow]", root);
  const ends = qa("[data-end]", root);
  const lead = q(".team-lead", root);
  const plane = q(".team-plane", root);
  const desktop = (): boolean => matchMedia(DESKTOP).matches;
  const wires = agents.map((_, i) =>
    q<SVGPathElement>(`[data-wire="${i}"]`, svg),
  );
  const taskWire = q<SVGPathElement>('[data-wire="task"]', svg);
  if (!lanePath || !taskWire || wires.some((wire) => !wire)) return;

  const paths = wires as SVGPathElement[];
  paths.forEach((path, i) => drawPath(path, i));
  drawPath(taskWire, 5);

  const dot = (back: boolean): SVGCircleElement => {
    const circle = document.createElementNS(NS, "circle");
    circle.setAttribute("r", back ? "3.5" : "4");
    circle.setAttribute("class", "impulse-dot");
    if (back) circle.style.fill = "var(--success)";
    circle.setAttribute("aria-hidden", "true");
    svg.appendChild(circle);
    gsap.set(circle, { opacity: 0 });
    return circle;
  };

  /* One outbound and one inbound dot per wire, plus a follow-up dot. */
  const out = paths.map(() => dot(false));
  const back = paths.map(() => dot(true));
  const followDot = dot(false);
  const taskDot = dot(false);
  const laneDot = dot(false);

  const setState = (
    el: Element | null | undefined,
    state: AgentState,
    label?: string,
  ): void => {
    if (!el) return;
    el.setAttribute("data-state", state);
    const text = q("[data-state-label]", el);
    if (text) text.textContent = label ?? state;
  };

  const wire = (path: SVGPathElement | null, live = true): void => {
    path?.setAttribute("data-live", String(live));
  };

  const setCount = (n: number): void => {
    if (countEl) countEl.textContent = String(n);
  };

  const lit = (el: Element | null | undefined, on: boolean): void => {
    el?.setAttribute("data-lit", String(on));
  };

  /* A brief lift toward the viewer, then settle. */
  const lift = (el: Element | null | undefined): void => {
    if (!el) return;
    gsap.fromTo(
      el,
      { z: 0, y: 0 },
      {
        z: desktop() ? 46 : 0,
        y: desktop() ? -8 : -3,
        duration: 0.28,
        ease: "power2.out",
        yoyo: true,
        repeat: 1,
        clearProps: "transform",
      },
    );
  };

  const pulseLead = (): void => {
    if (lead) {
      gsap.fromTo(
        lead,
        { scale: 1 },
        {
          scale: 1.035,
          duration: 0.2,
          yoyo: true,
          repeat: 1,
          clearProps: "transform",
        },
      );
    }
  };

  /* The chip leaves the lead node, flies out in front of the plane, and
   * settles into its slot. */
  const spawn = (chip: HTMLElement | null | undefined): void => {
    if (!chip) return;
    gsap.killTweensOf(chip);
    let dx = 0;
    let dy = -24;
    if (desktop() && lead) {
      dx =
        lead.offsetLeft +
        lead.offsetWidth -
        (chip.offsetLeft + chip.offsetWidth / 2);
      dy = lead.offsetTop - chip.offsetTop;
    }
    const flight = gsap.timeline({
      onComplete: () =>
        void gsap.set(chip, { clearProps: "transform,opacity" }),
    });
    flight
      .fromTo(
        chip,
        { x: dx, y: dy, scale: 0.3, opacity: 0, rotateX: desktop() ? -50 : 0 },
        {
          x: 0,
          y: 0,
          scale: 1,
          opacity: 1,
          rotateX: 0,
          duration: SEND,
          ease: "power3.out",
        },
        0,
      )
      .fromTo(
        chip,
        { z: 0 },
        {
          z: desktop() ? 110 : 0,
          duration: SEND * 0.45,
          ease: "power2.out",
          yoyo: true,
          repeat: 1,
        },
        0,
      );
    pulseLead();
  };

  const reset = (): void => {
    for (const [i, agent] of agents.entries()) {
      setState(agent, "queued");
      gsap.killTweensOf(agent);
      gsap.set(agent, { clearProps: "transform" });
      gsap.set(agent, { opacity: 0 });
      lit(agent, false);
      gsap.set(ends[i] ?? [], { opacity: 0 });
      wire(paths[i] ?? null, false);
      ends[i]?.setAttribute("data-charged", "false");
    }
    wire(taskWire, false);
    wire(lanePath ?? null, false);
    setState(taskChip, "queued");
    if (taskChip) gsap.set(taskChip, { opacity: 0 });
    setCount(0);
    if (statusEl) statusEl.textContent = "Assigning batch";
    if (follow) gsap.set(follow, { autoAlpha: 0, y: 4 });
  };

  const travel = (
    circle: SVGCircleElement,
    path: SVGPathElement,
    at: number,
    tl: gsap.core.Timeline,
    reverse = false,
  ): void => {
    tl.set(circle, { opacity: 1 }, at).to(
      circle,
      {
        motionPath: {
          path,
          align: path,
          alignOrigin: [0.5, 0.5],
          start: reverse ? 1 : 0,
          end: reverse ? 0 : 1,
        },
        duration: SEND,
        ease: "power2.inOut",
      },
      at,
    );
    tl.set(circle, { opacity: 0 }, at + SEND);
  };

  const tl = gsap.timeline({ repeat: -1, paused: true, repeatDelay: 0.5 });
  tl.call(reset, undefined, 0);

  /* 0. The lane's conversation hands its prompt to the lead. */
  tl.call(() => wire(lanePath), undefined, 0.2);
  travel(laneDot, lanePath, 0.2, tl);
  tl.call(() => wire(lanePath, false), undefined, 1.6);

  /* 1. Assign the batch outward. */
  const assignAt = 1.3;
  agents.forEach((_, i) => {
    const at = assignAt + i * 0.22;
    tl.call(() => wire(paths[i] ?? null, true), undefined, at);
    travel(out[i] as SVGCircleElement, paths[i] as SVGPathElement, at, tl);
    tl.call(() => spawn(agents[i]), undefined, at);
    tl.call(
      () => {
        setState(agents[i], "running");
        lit(agents[i], true);
        gsap.to(ends[i] ?? [], { opacity: 1, duration: 0.3 });
        ends[i]?.setAttribute("data-charged", "true");
      },
      undefined,
      at + SEND,
    );
  });

  /* The background task starts alongside, supervised, not reasoned about. */
  tl.call(() => wire(taskWire, true), undefined, assignAt + 0.9);
  travel(taskDot, taskWire, assignAt + 0.9, tl);
  tl.call(() => spawn(taskChip), undefined, assignAt + 0.9);
  tl.call(
    () => setState(taskChip, "running"),
    undefined,
    assignAt + 0.9 + SEND,
  );
  /* Running chips settle out of the glow once they are underway. */
  agents.forEach((_, i) => {
    tl.call(
      () => lit(agents[i], false),
      undefined,
      assignAt + i * 0.22 + SEND + 0.9,
    );
  });

  /* 2. Reports return in the order the work would finish. */
  const reportAt = [4.6, 6.4, 5.4, 4.0];
  let reported = 0;
  const report = (i: number, at: number): void => {
    travel(
      back[i] as SVGCircleElement,
      paths[i] as SVGPathElement,
      at,
      tl,
      true,
    );
    tl.call(
      () => {
        setState(agents[i], "done");
        lit(agents[i], true);
        lift(agents[i]);
        pulseLead();
        wire(paths[i] ?? null, false);
        reported += 1;
        setCount(Math.min(reported, 4));
        if (statusEl) {
          statusEl.textContent = reported >= 4 ? "Reports in" : "Reports in…";
        }
      },
      undefined,
      at + SEND,
    );
    tl.call(() => lit(agents[i], false), undefined, at + SEND + 1.2);
  };
  tl.call(() => (reported = 0), undefined, 0);
  [...reportAt.entries()]
    .sort((a, b) => a[1] - b[1])
    .forEach(([i, at]) => report(i, at));

  /* 3. Follow-up to an existing name: same agent, same context. */
  const followAt = 8.0;
  tl.call(
    () => {
      wire(paths[1] ?? null, true);
      if (statusEl) statusEl.textContent = "Following up";
    },
    undefined,
    followAt,
  );
  travel(followDot, paths[1] as SVGPathElement, followAt, tl);
  tl.call(
    () => {
      setState(agents[1], "running", "running again");
      lit(agents[1], true);
      lift(agents[1]);
    },
    undefined,
    followAt + SEND,
  );
  if (follow)
    tl.to(follow, { autoAlpha: 1, y: 0, duration: 0.5 }, followAt + SEND);
  report(1, followAt + 2.4);
  tl.call(() => wire(taskWire, false), undefined, followAt + 3.6);
  tl.to({}, { duration: 2.2 }, followAt + 2.4 + SEND);

  playWhileVisible(root, tl);

  /* The table eases flat as it scrolls into view. */
  if (plane) {
    gsap.matchMedia().add(DESKTOP, () => {
      gsap.fromTo(
        plane,
        { "--plane-x": "28deg" },
        {
          "--plane-x": "6deg",
          ease: "none",
          scrollTrigger: {
            trigger: root,
            start: "top 100%",
            end: "top 30%",
            scrub: 0.6,
          },
        },
      );
    });
  }

  /* Parallel projects: each lane's conversation breathes at its own pace. */
  qa("[data-lane-bar]", root).forEach((bar, i) => {
    const tween = gsap.fromTo(
      bar,
      { width: `${28 + jitter(i, 20)}%` },
      {
        width: `${78 + jitter(i + 4, 20)}%`,
        duration: 4 + jitter(i + 2, 3),
        ease: "sine.inOut",
        repeat: -1,
        yoyo: true,
        paused: true,
      },
    );
    playWhileVisible(root, tween);
  });
}
