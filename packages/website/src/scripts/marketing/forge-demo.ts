/* The Forge demo: plays the project setup from `forge-setup.ts` on the drawn
 * conversation and workbench (`ForgeDemo.astro`).
 *
 * One pass: type the ask; run each item's tool calls, and as an item is made
 * fly a chip naming it to where it lands (`data-fd-target`), live at once or
 * waiting for review; run the check and reload; reply. Then the bell counts
 * what waits, and the pointer reviews each item, allowing the extension on
 * its consent card, until its dock panel goes live. The figure's
 * `data-stage` (typing, building, review, live) and `data-overlay` (none,
 * bell, consent) drive what the CSS shows.
 *
 * The markup shows the finished setup, so nothing is needed without script;
 * with reduced motion the demo stays on it. The loop starts when the demo
 * scrolls into view and pauses while it is off screen.
 */

import {
  type ForgeSetupItem,
  type ForgeSetupStep,
  forgeSetupAsk,
  forgeSetupChecks,
  forgeSetupItems,
  forgeSetupReviewCount,
} from "./forge-setup";

const TYPE_MS = 16;
const READ_MS = 450;
const STEP_MS = 420;
const FLY_MS = 700;
const LAND_MS = 200;
const REPLY_MS = 1100;
const MOVE_MS = 700;
const PRESS_MS = 200;
const DECIDE_MS = 420;
const CONSENT_MS = 900;
const LIVE_MS = 4200;
const RESET_MS = 600;

function element(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const nextFrame = () =>
  new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );

function start(): void {
  const demo = document.querySelector<HTMLElement>("[data-forge-demo]");
  if (!demo) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const one = (selector: string) => demo.querySelector<HTMLElement>(selector);

  const ask = one("[data-fd-ask]");
  const steps = one("[data-fd-steps]");
  const bench = one("[data-fd-bench]");
  const badge = one("[data-fd-badge]");
  const count = one("[data-fd-count]");
  const bell = one("[data-fd-bell]");
  const panel = one("[data-fd-panel]");
  const allow = one("[data-fd-allow]");
  const cursor = demo.querySelector<SVGElement>("[data-fd-cursor]");
  const brands = demo.querySelector<HTMLTemplateElement>("[data-fd-brands]");
  if (
    !ask ||
    !steps ||
    !bench ||
    !badge ||
    !count ||
    !bell ||
    !panel ||
    !allow ||
    !cursor ||
    !brands
  ) {
    return;
  }
  const targets = (id: string) => [
    ...demo.querySelectorAll<HTMLElement>(`[data-fd-target="${id}"]`),
  ];
  const reviewRow = (id: string) => one(`[data-fd-review="${id}"]`);

  let visible = false;
  const wait = async (ms: number) => {
    let left = ms;
    while (left > 0) {
      const step = Math.min(left, 40);
      await new Promise((resolve) => setTimeout(resolve, step));
      if (visible && !document.hidden) left -= step;
    }
  };

  const setState = (id: string, state: "hidden" | "waiting" | "live") => {
    for (const target of targets(id)) target.dataset.state = state;
  };

  const setCount = (value: number) => {
    badge.textContent = String(value);
    count.textContent = String(value);
  };

  /* A tool call row: running, then done. */
  const runStep = async (step: ForgeSetupStep) => {
    const row = element("div", "fd-step is-running is-entering");
    row.append(
      element("span", "fd-status"),
      element("code", "", step.tool),
      element("span", "fd-detail", step.detail),
    );
    steps.append(row);
    await nextFrame();
    row.classList.remove("is-entering");
    await wait(STEP_MS);
    row.classList.replace("is-running", "is-done");
    return row;
  };

  /* A chip naming the item flies from its tool call to where it lands. */
  const fly = async (item: ForgeSetupItem, from: HTMLElement) => {
    const to = targets(item.id)[0];
    if (!to) return;
    const chip = element("span", "fd-fly");
    chip.append(element("span", "fd-kind", item.kindLabel));
    const mark = brands.content.querySelector(`[data-brand="${item.id}"]`);
    if (mark) chip.append(mark.cloneNode(true));
    chip.append(element("span", "", item.name));
    demo.append(chip);

    const box = demo.getBoundingClientRect();
    const source = from.getBoundingClientRect();
    const target = to.getBoundingClientRect();
    const width = chip.offsetWidth;
    const height = chip.offsetHeight;
    const at = (x: number, y: number, scale: number) =>
      `translate(${Math.round(x)}px, ${Math.round(y)}px) scale(${scale})`;
    chip.style.transition = "none";
    chip.style.transform = at(
      source.right - box.left - width - 8,
      source.top - box.top + (source.height - height) / 2,
      0.9,
    );
    void chip.offsetWidth;
    chip.style.transition = "";
    chip.style.opacity = "1";
    chip.style.transform = at(
      target.left - box.left + (target.width - width) / 2,
      target.top - box.top + (target.height - height) / 2,
      0.85,
    );
    await wait(FLY_MS);
    setState(item.id, item.review ? "waiting" : "live");
    chip.style.opacity = "0";
    await wait(LAND_MS);
    chip.remove();
  };

  /* The pointer, its tip on the middle of an element in the workbench. */
  const pointAt = async (node: HTMLElement) => {
    const frame = bench.getBoundingClientRect();
    const rect = node.getBoundingClientRect();
    cursor.style.setProperty(
      "--x",
      `${rect.left - frame.left + rect.width / 2 - 4}px`,
    );
    cursor.style.setProperty(
      "--y",
      `${rect.top - frame.top + rect.height / 2 - 2}px`,
    );
    await wait(MOVE_MS);
  };

  const press = async (node: HTMLElement) => {
    await pointAt(node);
    node.classList.add("is-pressed");
    await wait(PRESS_MS);
    node.classList.remove("is-pressed");
  };

  const reset = async () => {
    demo.dataset.stage = "typing";
    demo.dataset.overlay = "none";
    for (const item of forgeSetupItems) setState(item.id, "hidden");
    panel.dataset.state = "hidden";
    await wait(RESET_MS);
    for (const row of demo.querySelectorAll("[data-fd-review]")) {
      row.classList.remove("is-done");
    }
    setCount(forgeSetupReviewCount);
    steps.replaceChildren();
    ask.textContent = "";
  };

  const play = async () => {
    await reset();
    for (let length = 1; length <= forgeSetupAsk.length; length += 1) {
      ask.textContent = forgeSetupAsk.slice(0, length);
      await wait(TYPE_MS);
    }
    await wait(READ_MS);

    demo.dataset.stage = "building";
    for (const item of forgeSetupItems) {
      let last: HTMLElement | undefined;
      for (const step of item.steps) last = await runStep(step);
      if (last) await fly(item, last);
    }
    for (const step of forgeSetupChecks) await runStep(step);

    /* The reply, then the bell counts what waits. */
    demo.dataset.stage = "review";
    await wait(REPLY_MS);

    /* The user reviews: open the bell, decide each item. */
    const frame = bench.getBoundingClientRect();
    cursor.style.transition = "none";
    cursor.style.setProperty("--x", `${frame.width * 0.75}px`);
    cursor.style.setProperty("--y", `${frame.height * 0.8}px`);
    void cursor.getBoundingClientRect();
    cursor.style.transition = "";
    demo.classList.add("is-pointing");
    await press(bell);
    demo.dataset.overlay = "bell";
    await wait(DECIDE_MS);

    let waiting = forgeSetupReviewCount;
    for (const item of forgeSetupItems.filter((entry) => entry.review)) {
      const row = reviewRow(item.id);
      const button = row?.querySelector<HTMLElement>("[data-fd-review-button]");
      if (!row || !button) continue;
      await press(button);
      if (item.kind === "extension") {
        /* Only the user can allow it: the consent card lists what it asks for. */
        demo.dataset.overlay = "consent";
        await wait(CONSENT_MS);
        await press(allow);
        demo.dataset.overlay = "none";
        panel.dataset.state = "live";
      } else {
        row.classList.add("is-done");
      }
      setState(item.id, "live");
      waiting -= 1;
      if (waiting > 0) setCount(waiting);
      await wait(DECIDE_MS);
    }

    demo.classList.remove("is-pointing");
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
        await wait(LIVE_MS / 2);
        for (;;) await play();
      })();
    },
    { threshold: 0.3 },
  ).observe(demo);
}

start();
