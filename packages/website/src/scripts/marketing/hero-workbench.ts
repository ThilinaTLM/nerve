/* Hero workbench art: a short film played on the drawn workbench.
 *
 * Each chapter is one example run (`hero-prompts.ts`). A camera, a translate
 * plus a resize of the scene's container, moves through it: in on the
 * composer while the prompt types, along the transcript while tool calls run
 * (sub-agents fill the Agents tray, a plan to review appears inline), onto
 * whatever the run produced, then back out. The app reacts as it would: the
 * conversation's ring spins while the agent works, the side panel switches
 * to Launches for a launch, the dock shows the panel Forge built, and the
 * bell collects the finished run. The chapter buttons jump straight to a run.
 *
 * The markup shows the first run finished in the overview, so the art reads
 * the same without script. With reduced motion nothing plays on its own and
 * a chapter button shows its run finished, without camera moves. The film
 * pauses while the art is off screen or the tab is hidden.
 */

import {
  type HeroAgent,
  type HeroPrompt,
  type HeroStep,
  heroPrompts,
} from "./hero-prompts";

const START_MS = 1400;
const RISEN_MS = 2000;
const MOVE_MS = 750;
const TYPE_MS = 10;
const TYPE_JITTER_MS = 10;
const READ_MS = 1000;
const STEP_MS = 400;
const AGENT_MS = 260;
const ASK_MS = 900;
const EFFECT_MS = 1800;
const OVERVIEW_MS = 800;
const LIT_MS = 2000;
const NOTIFY_MS = 2200;
const NOTIF_ROWS = 3;

type Camera = { x: number; y: number; s: number };

const OVERVIEW: Camera = { x: 0, y: 0, s: 1 };

type ToolStep = Extract<HeroStep, { tool: string }>;

function element(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/* Appends with the settled class one frame late so the row eases in. */
function enter(parent: HTMLElement, node: HTMLElement, instant = false): void {
  if (!instant) node.classList.add("is-entering");
  parent.append(node);
  if (instant) return;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => node.classList.remove("is-entering")),
  );
}

function stepRow(step: ToolStep, done = false) {
  const row = element("div", `wb-step ${done ? "is-done" : "is-running"}`);
  row.append(element("span", "wb-status"), element("code", "", step.tool));
  row.append(element("span", "wb-step-detail", step.detail));
  return row;
}

function agentRow(agent: HeroAgent, done = false) {
  const row = element("span", `wb-agent ${done ? "is-done" : "is-running"}`);
  row.append(
    element("span", "wb-status"),
    element("span", "", agent.name),
    element("span", "wb-agent-profile", agent.profile),
  );
  return row;
}

function askCard(step: Extract<HeroStep, { ask: string }>) {
  const card = element("div", "wb-ask", step.ask);
  card.append(element("span", "wb-ask-action", step.action));
  return card;
}

const easeInOut = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

function start(): void {
  const art = document.querySelector<HTMLElement>("[data-hero-workbench]");
  if (!art) return;
  const one = (selector: string) => art.querySelector<HTMLElement>(selector);

  const nodes = {
    camera: one("[data-wb-camera]"),
    transcript: one("[data-wb-transcript]"),
    composer: one("[data-wb-composer]"),
    input: one("[data-wb-input]"),
    profile: one("[data-wb-profile]"),
    tray: one("[data-wb-tray]"),
    trayRows: one("[data-wb-tray-rows]"),
    trayCount: one("[data-wb-tray-count]"),
    convTitle: one("[data-wb-conv-title]"),
    chatTitle: one("[data-wb-chat-title]"),
    launch: one("[data-wb-launch]"),
    prNumber: one("[data-wb-pr-number]"),
    prTitle: one("[data-wb-pr-title]"),
    badge: one("[data-wb-badge]"),
    notifs: one("[data-wb-notifs]"),
    phoneTitle: one("[data-wb-phone-title]"),
    phoneBody: one("[data-wb-phone-body]"),
    caption: one("[data-wb-caption]"),
    num: one("[data-wb-num]"),
  };
  if (Object.values(nodes).some((node) => !node)) return;
  const n = nodes as { [K in keyof typeof nodes]: HTMLElement };
  const chapters = [
    ...art.querySelectorAll<HTMLButtonElement>("[data-wb-chapter]"),
  ];

  const cards: Record<HeroPrompt["effect"], HTMLElement | null> = {
    dock: one("[data-wb-card='dock']"),
    pr: one("[data-wb-card='pr']"),
    agents: one("[data-wb-card='agents']"),
    jira: one("[data-wb-card='jira']"),
    mcp: one("[data-wb-card='mcp']"),
    launches: one("[data-wb-card='launches']"),
    phone: one("[data-wb-card='phone']"),
  };

  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* Release the rise animation once every layer has landed (see the
   * `.is-risen` rule). */
  setTimeout(() => art.classList.add("is-risen"), RISEN_MS);

  let visible = true;
  new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? true;
  }).observe(art);

  /* Every film run has a token; starting another chapter retires the old one,
   * and its pending waits resolve false so it stops where it is. */
  let token = 0;

  /* Waits `ms` of time the art is actually on screen. */
  const wait = async (ms: number, mine: number) => {
    let left = ms;
    while (left > 0 && mine === token) {
      const step = Math.min(left, 40);
      await new Promise((resolve) => setTimeout(resolve, step));
      if (visible && !document.hidden) left -= step;
    }
    return mine === token;
  };

  /* Camera ------------------------------------------------------------- */

  const cam: Camera = { ...OVERVIEW };
  let move = 0;

  /* Zoom resizes the camera container (see `.wb-camera`), so the scene is
   * laid out at its zoomed size instead of being scaled as a bitmap. */
  const applyCamera = () => {
    const frame = n.camera.parentElement!;
    n.camera.style.width = `${(frame.clientWidth * cam.s).toFixed(2)}px`;
    n.camera.style.height = `${(frame.clientHeight * cam.s).toFixed(2)}px`;
    n.camera.style.transform = `translate(${cam.x.toFixed(2)}px, ${cam.y.toFixed(2)}px)`;
  };

  const moveTo = (to: Camera, ms = MOVE_MS) =>
    new Promise<void>((resolve) => {
      const id = ++move;
      const from = { ...cam };
      const began = performance.now();
      const frame = (now: number) => {
        if (id !== move) return resolve();
        const t = Math.min(1, (now - began) / ms);
        const k = easeInOut(t);
        cam.x = from.x + (to.x - from.x) * k;
        cam.y = from.y + (to.y - from.y) * k;
        cam.s = from.s + (to.s - from.s) * k;
        applyCamera();
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });

  /* The camera that centres `target` and zooms until it fills most of the
   * frame, capped at `zoom`. Measured through the current camera. */
  const framing = (target: HTMLElement, zoom: number): Camera => {
    const stage = art.getBoundingClientRect();
    const box = target.getBoundingClientRect();
    const width = box.width / cam.s;
    const height = box.height / cam.s;
    const x = (box.left + box.width / 2 - stage.left - cam.x) / cam.s;
    const y = (box.top + box.height / 2 - stage.top - cam.y) / cam.s;
    const s = Math.max(
      1,
      Math.min(
        zoom,
        (stage.width * 0.8) / width,
        (stage.height * 0.6) / height,
      ),
    );
    return { s, x: stage.width / 2 - x * s, y: stage.height * 0.42 - y * s };
  };

  const focus = (target: HTMLElement | null, zoom: number) =>
    target ? moveTo(framing(target, zoom)) : Promise.resolve();

  window.addEventListener("resize", () => {
    move += 1;
    Object.assign(cam, OVERVIEW);
    for (const property of ["width", "height", "transform"]) {
      n.camera.style.removeProperty(property);
    }
  });

  /* Pieces of a run ----------------------------------------------------- */

  /* The current chapter's segment fills to `value` (0 to 1). */
  let current = 0;
  const progress = (value: number) =>
    chapters[current]?.style.setProperty("--p", String(value));

  const setChapter = (index: number, prompt: HeroPrompt) => {
    current = index;
    for (const [at, button] of chapters.entries()) {
      button.setAttribute("aria-pressed", String(at === index));
      button.style.setProperty("--p", at < index ? "1" : "0");
    }
    n.caption.textContent = prompt.caption;
    n.num.textContent = String(index + 1).padStart(2, "0");
    art.dataset.profile = prompt.profile;
    art.dataset.side = "conversations";
    art.dataset.dock = "git";
    n.profile.textContent = prompt.label;
    n.convTitle.textContent = prompt.title;
    n.chatTitle.textContent = prompt.title;
    n.launch.dataset.wbLaunch = "ok";
    art.classList.remove("has-agents", "is-firing", "is-notifying");
    n.trayRows.replaceChildren();
    n.trayCount.textContent = "0";
  };

  const light = (card: HTMLElement | null) => {
    if (!card) return;
    card.classList.remove("is-lit");
    void card.offsetWidth;
    card.classList.add("is-lit");
    setTimeout(() => card.classList.remove("is-lit"), LIT_MS);
  };

  const addAgents = (agents: readonly HeroAgent[], done: boolean) => {
    art.classList.add("has-agents");
    const rows = agents.map((agent) => agentRow(agent, done));
    n.trayRows.append(...rows);
    n.trayCount.textContent = String(n.trayRows.children.length);
    return rows;
  };

  const notify = (prompt: HeroPrompt, instant: boolean) => {
    const row = element("div", "wb-notif-row");
    row.append(element("span", "wb-check"), element("span", "", prompt.title));
    n.notifs.prepend(row);
    while (n.notifs.children.length > NOTIF_ROWS)
      n.notifs.lastElementChild?.remove();
    n.badge.textContent = String(Number(n.badge.textContent) + 1);
    n.phoneTitle.textContent = prompt.push;
    n.phoneBody.textContent = `aurora · ${prompt.title}`;
    if (instant) return;
    art.classList.add("is-notifying");
    setTimeout(() => art.classList.remove("is-notifying"), NOTIFY_MS);
  };

  /* What a run's end changes in the app, before the camera arrives. */
  const land = (prompt: HeroPrompt, instant: boolean) => {
    enter(n.transcript, element("p", "wb-reply", prompt.reply), instant);
    if (prompt.effect === "dock") art.dataset.dock = "env";
    if (prompt.effect === "launches") n.launch.dataset.wbLaunch = "ok";
    if (prompt.effect === "pr") {
      n.prNumber.textContent = "#57";
      n.prTitle.textContent = prompt.title;
    }
    notify(prompt, instant);
    if (instant) return;
    if (prompt.effect === "dock") {
      void art.offsetWidth;
      art.classList.add("is-firing");
    }
    light(cards[prompt.effect]);
  };

  /* A chapter's end state at once: for reduced motion. */
  const show = (index: number) => {
    const prompt = heroPrompts[index]!;
    setChapter(index, prompt);
    if (prompt.effect === "launches") art.dataset.side = "launches";
    n.transcript.replaceChildren(element("div", "wb-bubble", prompt.text));
    for (const step of prompt.steps) {
      if ("tool" in step) n.transcript.append(stepRow(step, true));
      else if ("agents" in step) addAgents(step.agents, true);
      else n.transcript.append(askCard(step));
    }
    land(prompt, true);
    progress(1);
  };

  const play = async (index: number, mine: number) => {
    const prompt = heroPrompts[index]!;
    setChapter(index, prompt);
    progress(0.05);

    /* In on the composer; the prompt types. */
    await focus(n.composer, 2.1);
    if (mine !== token) return false;
    n.composer.classList.add("is-typing");
    for (let length = 1; length <= prompt.text.length; length += 1) {
      n.input.textContent = prompt.text.slice(0, length);
      if (!(await wait(TYPE_MS + Math.random() * TYPE_JITTER_MS, mine))) {
        return false;
      }
    }
    progress(0.3);
    if (!(await wait(READ_MS, mine))) return false;

    /* Sent: the composer clears and the run starts. */
    n.composer.classList.remove("is-typing");
    n.composer.classList.add("is-sent");
    n.input.textContent = "";
    n.transcript.replaceChildren();
    enter(n.transcript, element("div", "wb-bubble", prompt.text));
    art.classList.add("is-running");
    if (prompt.effect === "launches") {
      art.dataset.side = "launches";
      n.launch.dataset.wbLaunch = "crashed";
    }
    void focus(
      prompt.effect === "launches" ? cards.launches : n.transcript,
      1.9,
    );
    if (!(await wait(300, mine))) return false;
    n.composer.classList.remove("is-sent");

    for (const [at, step] of prompt.steps.entries()) {
      progress(0.35 + (0.45 * (at + 1)) / prompt.steps.length);
      if ("agents" in step) {
        const rows = addAgents(step.agents, false);
        void focus(n.tray, 2.2);
        for (const row of rows) {
          if (!(await wait(AGENT_MS, mine))) return false;
          row.classList.replace("is-running", "is-done");
        }
        continue;
      }
      if ("ask" in step) {
        enter(n.transcript, askCard(step));
        if (!(await wait(ASK_MS, mine))) return false;
        continue;
      }
      const row = stepRow(step);
      enter(n.transcript, row);
      if (!(await wait(STEP_MS, mine))) return false;
      row.classList.replace("is-running", "is-done");
    }

    /* The result: the app reacts and the camera flies to it. */
    art.classList.remove("is-running");
    land(prompt, false);
    progress(0.9);
    await focus(cards[prompt.effect], 2.6);
    if (!(await wait(EFFECT_MS, mine))) return false;

    progress(1);
    await moveTo(OVERVIEW);
    return wait(OVERVIEW_MS, mine);
  };

  const film = (from: number, delay = 0) => {
    const mine = ++token;
    void (async () => {
      if (!(await wait(delay, mine))) return;
      for (let index = from; ; index = (index + 1) % heroPrompts.length) {
        if (!(await play(index, mine))) return;
      }
    })();
  };

  for (const [index, button] of chapters.entries()) {
    button.addEventListener("click", () => {
      if (reducedMotion) {
        show(index);
        return;
      }
      n.composer.classList.remove("is-typing", "is-sent");
      art.classList.remove("is-running");
      n.input.textContent = "";
      film(index);
    });
  }

  if (!reducedMotion) film(0, START_MS);
}

start();
