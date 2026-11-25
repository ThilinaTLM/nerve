/* Hero workbench art: a short film played on the drawn workbench.
 *
 * Each chapter is one example run (`hero-prompts.ts`). A camera, a
 * translate plus a resize of the scene's container, moves through it: in on the
 * composer while the prompt types, along the transcript while tool calls run,
 * onto whatever the run produced (the panel Forge built, the pull request,
 * the Jira issue, the phone that gets the push), then back out. The chapter
 * buttons under the art jump straight to a run.
 *
 * The markup shows the first run finished in the overview, so the art reads
 * the same without script. With reduced motion nothing plays on its own and
 * a chapter button shows its run finished, without camera moves. The film
 * pauses while the art is off screen or the tab is hidden.
 */

import { type HeroPrompt, type HeroStep, heroPrompts } from "./hero-prompts";

const START_MS = 3000;
const RISEN_MS = 2200;
const MOVE_MS = 1100;
const TYPE_MS = 16;
const TYPE_JITTER_MS = 14;
const READ_MS = 1500;
const STEP_MS = 620;
const AGENT_MS = 380;
const EFFECT_MS = 2600;
const OVERVIEW_MS = 1500;
const LIT_MS = 2400;

type Camera = { x: number; y: number; s: number };

const OVERVIEW: Camera = { x: 0, y: 0, s: 1 };

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

function stepRow(step: Exclude<HeroStep, { agents: readonly string[] }>) {
  const row = element("div", "wb-step is-running");
  row.append(element("span", "wb-status"), element("code", "", step.tool));
  row.append(element("span", "wb-step-detail", step.detail));
  return row;
}

function agentsRow(names: readonly string[]) {
  const row = element("div", "wb-agents");
  for (const name of names) {
    const agent = element("span", "wb-agent is-running");
    agent.append(
      element("span", "wb-status"),
      element("span", "", `developer · ${name}`),
    );
    row.append(agent);
  }
  return row;
}

const easeInOut = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

function start(): void {
  const art = document.querySelector<HTMLElement>("[data-hero-workbench]");
  if (!art) return;
  const one = <T extends HTMLElement = HTMLElement>(selector: string) =>
    art.querySelector<T>(selector);

  const camera = one("[data-wb-camera]");
  const transcript = one("[data-wb-transcript]");
  const composer = one("[data-wb-composer]");
  const input = one("[data-wb-input]");
  const profile = one("[data-wb-profile]");
  const phoneTitle = one("[data-wb-phone-title]");
  const phoneBody = one("[data-wb-phone-body]");
  const caption = one("[data-wb-caption]");
  const chapters = [
    ...art.querySelectorAll<HTMLButtonElement>("[data-wb-chapter]"),
  ];
  if (
    !camera ||
    !transcript ||
    !composer ||
    !input ||
    !profile ||
    !phoneTitle ||
    !phoneBody ||
    !caption
  ) {
    return;
  }

  const cards = {
    dock: one("[data-wb-card='dock']"),
    pr: one("[data-wb-card='pr']"),
    jira: one("[data-wb-card='jira']"),
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
      const step = Math.min(left, 50);
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
    const frame = camera.parentElement!;
    camera.style.width = `${(frame.clientWidth * cam.s).toFixed(2)}px`;
    camera.style.height = `${(frame.clientHeight * cam.s).toFixed(2)}px`;
    camera.style.transform = `translate(${cam.x.toFixed(2)}px, ${cam.y.toFixed(2)}px)`;
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
   * stage, capped at `zoom`. Measured through the current camera. */
  const framing = (target: HTMLElement, zoom: number): Camera => {
    const stage = art.getBoundingClientRect();
    const box = target.getBoundingClientRect();
    const width = box.width / cam.s;
    const height = box.height / cam.s;
    const x = (box.left + box.width / 2 - stage.left - cam.x) / cam.s;
    const y = (box.top + box.height / 2 - stage.top - cam.y) / cam.s;
    const s = Math.min(
      zoom,
      (stage.width * 0.86) / width,
      (stage.height * 0.7) / height,
    );
    return { s, x: stage.width / 2 - x * s, y: stage.height * 0.46 - y * s };
  };

  const focus = (target: HTMLElement | null, zoom: number) =>
    target ? moveTo(framing(target, zoom)) : Promise.resolve();

  window.addEventListener("resize", () => {
    move += 1;
    Object.assign(cam, OVERVIEW);
    camera.style.removeProperty("width");
    camera.style.removeProperty("height");
    camera.style.removeProperty("transform");
  });

  /* Pieces of a run ----------------------------------------------------- */

  const setChapter = (index: number, prompt: HeroPrompt) => {
    for (const [at, button] of chapters.entries()) {
      button.setAttribute("aria-pressed", String(at === index));
    }
    caption.textContent = prompt.caption;
    art.dataset.profile = prompt.profile;
    profile.textContent = prompt.label;
  };

  const light = (card: HTMLElement | null) => {
    if (!card) return;
    card.classList.remove("is-lit");
    void card.offsetWidth;
    card.classList.add("is-lit");
    setTimeout(() => card.classList.remove("is-lit"), LIT_MS);
  };

  const finish = (prompt: HeroPrompt, instant: boolean) => {
    enter(transcript, element("p", "wb-reply", prompt.reply), instant);
    phoneTitle.textContent = prompt.push;
    phoneBody.textContent = `aurora · ${prompt.title}`;
    if (instant) return;
    if (prompt.effect === "dock") {
      art.classList.remove("is-firing");
      void art.offsetWidth;
      art.classList.add("is-firing");
    }
    light(cards[prompt.effect]);
  };

  /* A chapter's end state at once: for reduced motion. */
  const show = (index: number) => {
    const prompt = heroPrompts[index]!;
    setChapter(index, prompt);
    transcript.replaceChildren(element("div", "wb-bubble", prompt.text));
    for (const step of prompt.steps) {
      if ("agents" in step) {
        const row = agentsRow(step.agents);
        for (const agent of row.children) {
          agent.classList.replace("is-running", "is-done");
        }
        transcript.append(row);
      } else {
        const row = stepRow(step);
        row.classList.replace("is-running", "is-done");
        transcript.append(row);
      }
    }
    finish(prompt, true);
  };

  const play = async (index: number, mine: number) => {
    const prompt = heroPrompts[index]!;
    setChapter(index, prompt);

    /* In on the composer; the prompt types. */
    await focus(composer, 2.4);
    if (mine !== token) return false;
    composer.classList.add("is-typing");
    for (let length = 1; length <= prompt.text.length; length += 1) {
      input.textContent = prompt.text.slice(0, length);
      if (!(await wait(TYPE_MS + Math.random() * TYPE_JITTER_MS, mine))) {
        return false;
      }
    }
    if (!(await wait(READ_MS, mine))) return false;

    /* Sent: the composer clears and the run starts in the transcript. */
    composer.classList.remove("is-typing");
    composer.classList.add("is-sent");
    input.textContent = "";
    transcript.replaceChildren();
    enter(transcript, element("div", "wb-bubble", prompt.text));
    void focus(transcript, 1.9);
    if (!(await wait(450, mine))) return false;
    composer.classList.remove("is-sent");

    for (const step of prompt.steps) {
      if ("agents" in step) {
        const row = agentsRow(step.agents);
        enter(transcript, row);
        for (const agent of row.children) {
          if (!(await wait(AGENT_MS, mine))) return false;
          agent.classList.replace("is-running", "is-done");
        }
        continue;
      }
      const row = stepRow(step);
      enter(transcript, row);
      if (!(await wait(STEP_MS, mine))) return false;
      row.classList.replace("is-running", "is-done");
    }

    /* The result: the camera flies to what the run produced. */
    finish(prompt, false);
    if (!(await wait(500, mine))) return false;
    await focus(cards[prompt.effect], 2.6);
    if (!(await wait(EFFECT_MS, mine))) return false;

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
      composer.classList.remove("is-typing", "is-sent");
      input.textContent = "";
      film(index);
    });
  }

  if (!reducedMotion) film(0, START_MS);
}

start();
