/* The Forge demo: plays each build in `forge-demo-builds.ts` on the drawn
 * conversation and workbench (`ForgeDemo.astro`).
 *
 * A build types the request, runs its tool calls while the file it writes
 * travels into the workbench, shows the consent card, moves the pointer to
 * Allow and presses it, then shows the extension live. The figure's
 * `data-stage` (typing, building, consent, live) and `data-kind` (panel,
 * page) drive what the CSS shows.
 *
 * The markup shows the first build live, so nothing is needed without
 * script; with reduced motion the demo stays on it. The loop starts when the
 * demo scrolls into view and pauses while it is off screen.
 */

import {
  type ForgeDemoBuild,
  forgeDemoBuilds,
  forgeDemoSteps,
} from "./forge-demo-builds";

const TYPE_MS = 18;
const READ_MS = 500;
const STEP_MS = 520;
const FLY_MS = 700;
const CONSENT_MS = 700;
const POINT_MS = 800;
const PRESS_MS = 220;
const LIVE_MS = 2800;

function element(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function start(): void {
  const demo = document.querySelector<HTMLElement>("[data-forge-demo]");
  if (!demo) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const one = (selector: string) => demo.querySelector<HTMLElement>(selector);

  const ask = one("[data-fd-ask]");
  const steps = one("[data-fd-steps]");
  const file = one("[data-fd-file]");
  const asks = one("[data-fd-asks]");
  const consentName = one("[data-fd-consent-name]");
  const tabName = one("[data-fd-tab-name]");
  const brands = demo.querySelector<HTMLTemplateElement>("[data-fd-brands]");
  const results = [...demo.querySelectorAll<HTMLElement>("[data-fd-result]")];
  if (!ask || !steps || !file || !asks || !consentName || !tabName || !brands) {
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

  /* The build's brand mark, or nothing. */
  const brandOf = (build: ForgeDemoBuild) => {
    const mark = brands.content.querySelector(`[data-brand="${build.id}"]`);
    return mark ? [...mark.childNodes].map((node) => node.cloneNode(true)) : [];
  };

  const setBrand = (slot: Element | null, build: ForgeDemoBuild) =>
    slot?.replaceChildren(...brandOf(build));

  const fillResult = (build: ForgeDemoBuild) => {
    for (const result of results) {
      const title = element("span", "fd-result-title");
      const brand = element("span", "fd-brand");
      brand.append(...brandOf(build));
      title.append(brand, element("span", "", build.name));
      const rows = build.rows.map((row) => {
        const line = element("span", "fd-row");
        line.append(
          element("span", `fd-dot is-${row.tone}`),
          element("span", "fd-row-label", row.label),
          element("span", `fd-row-meta is-${row.tone}`, row.meta),
        );
        return line;
      });
      result.replaceChildren(
        title,
        ...rows,
        element("span", "fd-tag", "Built by Forge"),
      );
    }
  };

  const fly = async (name: string) => {
    file.classList.remove("is-flying");
    file.textContent = name;
    void file.offsetWidth;
    file.classList.add("is-flying");
    await wait(FLY_MS);
    file.classList.remove("is-flying");
  };

  const play = async (build: ForgeDemoBuild) => {
    demo.dataset.stage = "typing";
    demo.dataset.kind = build.kind;
    demo.classList.remove("is-pointing", "is-pressing");
    steps.replaceChildren();
    ask.textContent = "";
    for (let length = 1; length <= build.ask.length; length += 1) {
      ask.textContent = build.ask.slice(0, length);
      await wait(TYPE_MS);
    }
    await wait(READ_MS);

    demo.dataset.stage = "building";
    for (const step of forgeDemoSteps(build)) {
      const row = element("div", "fd-step is-running is-entering");
      row.append(
        element("span", "fd-status"),
        element("code", "", step.tool),
        element("span", "fd-detail", step.detail),
      );
      steps.append(row);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => row.classList.remove("is-entering")),
      );
      if (step.tool === "write") void fly(build.source.split("/").pop()!);
      await wait(STEP_MS);
      row.classList.replace("is-running", "is-done");
    }

    /* Pending consent: what it asks for, and the user allows it. */
    consentName.textContent = build.name;
    setBrand(one("[data-fd-consent-brand]"), build);
    asks.replaceChildren(...build.asks.map((text) => element("li", "", text)));
    fillResult(build);
    tabName.textContent = build.name;
    setBrand(one("[data-fd-tab-brand]"), build);
    demo.dataset.stage = "consent";
    await wait(CONSENT_MS);
    demo.classList.add("is-pointing");
    await wait(POINT_MS);
    demo.classList.add("is-pressing");
    await wait(PRESS_MS);
    demo.classList.remove("is-pressing", "is-pointing");

    demo.dataset.stage = "live";
    await wait(LIVE_MS);
  };

  let started = false;
  new IntersectionObserver(
    ([entry]) => {
      visible = entry?.isIntersecting ?? false;
      if (!visible || started) return;
      started = true;
      void (async () => {
        await wait(LIVE_MS);
        for (let index = 1; ; index = (index + 1) % forgeDemoBuilds.length) {
          await play(forgeDemoBuilds[index]!);
        }
      })();
    },
    { threshold: 0.35 },
  ).observe(demo);
}

start();
