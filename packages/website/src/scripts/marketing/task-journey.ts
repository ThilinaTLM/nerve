/* The task journey: plays one run on the drawn window in `TaskJourney.astro`.
 *
 * For each of the five steps the impulse travels the track to the next
 * station (`--p`), the station lights and stays lit, a spark hands off to the
 * stage (`is-handing`), and the window moves to that step: `data-step` and
 * `data-view` (lead, child, pr) on the root pick the header, transcript layer
 * and pull request pane; each `[data-tj]` element's `data-state` (hidden,
 * running, done, pending, merged) shows how far it got.
 *
 * The markup is the finished run, so nothing is needed without script; with
 * reduced motion the section stays on it. The loop starts when the section
 * scrolls into view and pauses while it is off screen.
 */

export {};

const TASK = "Add rate limiting to the booking API";
const STEPS = 5;

const TYPE_MS = 38;
const TRAVEL_MS = 700;
const HANDOFF_MS = 520;
const REWIND_MS = 500;

type View = "lead" | "child" | "pr";

function start(): void {
  const root = document.querySelector<HTMLElement>("[data-task-journey]");
  if (!root) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const all = (name: string) => [
    ...root.querySelectorAll<HTMLElement>(`[data-tj="${name}"]`),
  ];
  const one = (name: string) => all(name)[0];
  const input = one("input");
  const composer = one("composer");
  const approve = one("approve");
  const merge = one("merge");
  const stations = [...root.querySelectorAll<HTMLElement>("[data-tj-station]")];
  if (!input || !composer || !approve || !merge || stations.length !== STEPS) {
    return;
  }

  let visible = false;
  const wait = async (ms: number) => {
    let left = ms;
    while (left > 0) {
      const step = Math.min(left, 40);
      await new Promise((resolve) => setTimeout(resolve, step));
      if (visible && !document.hidden) left -= step;
    }
  };

  const set = (name: string, state: string) => {
    for (const element of all(name)) element.dataset.state = state;
  };

  const view = (next: View) => {
    root.dataset.view = next;
  };

  const press = async (button: HTMLElement) => {
    button.classList.add("is-pressing");
    await wait(200);
    button.classList.remove("is-pressing");
  };

  /* Back to the start: every station dark, every row waiting. */
  const reset = () => {
    root.style.setProperty("--p", "0");
    root.dataset.step = "1";
    view("lead");
    for (const station of stations) {
      delete station.dataset.lit;
      delete station.dataset.active;
    }
    for (const name of ["bubble", "spawn", "reply", "approval", "tray"]) {
      set(name, "hidden");
    }
    for (const name of ["read", "edit", "test"]) set(name, "hidden");
    for (let index = 0; index < 3; index += 1) {
      set(`agent-${index}`, "hidden");
      set(`check-${index}`, "hidden");
    }
    set("pr", "open");
    input.textContent = "";
    composer.classList.remove("is-typing", "is-sent", "is-disabled");
  };

  /* The impulse reaches station `step`, which lights and hands off. */
  const reach = async (step: number) => {
    root.style.setProperty("--p", String((step - 1) / (STEPS - 1)));
    await wait(TRAVEL_MS);
    for (const station of stations) delete station.dataset.active;
    const station = stations[step - 1]!;
    station.dataset.lit = "";
    station.dataset.active = "";
    root.classList.remove("is-handing");
    void root.offsetWidth;
    root.classList.add("is-handing");
    await wait(HANDOFF_MS * 0.6);
    root.dataset.step = String(step);
    window.setTimeout(
      () => root.classList.remove("is-handing"),
      HANDOFF_MS * 0.5,
    );
  };

  const run = async (first: boolean) => {
    /* 1 You ask. The first run starts from the reset below; later ones
     * fade the finished run out first. */
    if (!first) {
      root.classList.add("is-rewinding");
      await wait(REWIND_MS);
      reset();
      await wait(REWIND_MS);
      root.classList.remove("is-rewinding");
    }
    await reach(1);
    const starter = one("starter");
    if (starter) await press(starter);
    composer.classList.add("is-typing");
    await wait(300);
    for (let length = 1; length <= TASK.length; length += 1) {
      input.textContent = TASK.slice(0, length);
      await wait(TYPE_MS);
    }
    await wait(450);
    composer.classList.add("is-sent");
    await wait(200);
    composer.classList.remove("is-sent", "is-typing");

    /* 2 The lead splits it. */
    await reach(2);
    input.textContent = "";
    set("bubble", "done");
    await wait(380);
    set("spawn", "running");
    await wait(800);
    set("spawn", "done");
    set("tray", "done");
    for (let index = 0; index < 3; index += 1) {
      await wait(170);
      set(`agent-${index}`, "running");
    }
    await wait(1300);

    /* 3 Agents work in the open: the developer's conversation. */
    await reach(3);
    view("child");
    await wait(500);
    for (const [name, ms] of [
      ["read", 600],
      ["edit", 750],
      ["test", 1000],
    ] as const) {
      set(name, "running");
      await wait(ms);
      set(name, "done");
      if (name === "read") set("agent-0", "done");
      await wait(160);
    }
    set("agent-1", "done");
    await wait(300);
    set("agent-2", "done");
    await wait(1000);

    /* 4 You approve the push. */
    await reach(4);
    view("lead");
    await wait(380);
    set("reply", "done");
    await wait(450);
    set("approval", "pending");
    composer.classList.add("is-disabled");
    await wait(1500);
    await press(approve);
    set("approval", "running");
    composer.classList.remove("is-disabled");
    await wait(800);
    set("approval", "done");
    await wait(800);

    /* 5 It ships. */
    await reach(5);
    view("pr");
    await wait(450);
    for (let index = 0; index < 3; index += 1) {
      set(`check-${index}`, "running");
      await wait(110);
    }
    for (let index = 0; index < 3; index += 1) {
      await wait(index === 0 ? 650 : 380);
      set(`check-${index}`, "done");
    }
    await wait(700);
    await press(merge);
    set("pr", "merged");
    await wait(3200);
  };

  /* Script is running: show the start of the run rather than its end. */
  root.classList.add("is-rewinding");
  reset();
  requestAnimationFrame(() =>
    requestAnimationFrame(() => root.classList.remove("is-rewinding")),
  );

  let started = false;
  new IntersectionObserver(
    ([entry]) => {
      visible = entry?.isIntersecting ?? false;
      if (!visible || started) return;
      started = true;
      void (async () => {
        await wait(400);
        for (let first = true; ; first = false) await run(first);
      })();
    },
    { threshold: 0.35 },
  ).observe(root);
}

start();
