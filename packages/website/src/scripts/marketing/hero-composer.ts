/* Hero composer: example prompts typing themselves into the drawn composer,
 * each under the lead profile that would take it. On "send" the prompt goes
 * to the workbench art (`nerve:hero-prompt`), the composer shows the app's
 * placeholder while the run plays, then the next prompt types.
 *
 * The markup shows the first prompt, so without script or with reduced
 * motion nothing changes; with motion the loop retypes it first. The loop pauses while the hero is off
 * screen or the tab is hidden.
 */

import { heroPrompts, type HeroPrompt, runDuration } from "./hero-prompts";

const START_MS = 600;
const HOLD_MS = 900;
const TYPE_MS = 14;
const TYPE_JITTER_MS = 14;
const PLACEHOLDER = "Ask the local Nerve agent";

function start(): void {
  const composer = document.querySelector<HTMLElement>("[data-hero-composer]");
  const text = composer?.querySelector<HTMLElement>("[data-composer-text]");
  const label = composer?.querySelector<HTMLElement>("[data-composer-profile]");
  if (!composer || !text || !label) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  let visible = true;
  new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? true;
  }).observe(composer);

  /* Waits `ms` of time the hero is actually on screen. */
  const wait = async (ms: number) => {
    let left = ms;
    while (left > 0) {
      const step = Math.min(left, 50);
      await new Promise((resolve) => setTimeout(resolve, step));
      if (visible && !document.hidden) left -= step;
    }
  };

  const send = (prompt: HeroPrompt) =>
    window.dispatchEvent(
      new CustomEvent<HeroPrompt>("nerve:hero-prompt", { detail: prompt }),
    );

  const type = async (prompt: HeroPrompt) => {
    text.textContent = "";
    composer.classList.remove("is-waiting");
    composer.dataset.profile = prompt.profile;
    label.textContent = prompt.label;
    for (let length = 1; length <= prompt.text.length; length += 1) {
      text.textContent = prompt.text.slice(0, length);
      await wait(TYPE_MS + Math.random() * TYPE_JITTER_MS);
    }
    await wait(HOLD_MS);
  };

  void (async () => {
    await wait(START_MS);
    for (let index = 0; ; index = (index + 1) % heroPrompts.length) {
      const prompt = heroPrompts[index]!;
      await type(prompt);
      send(prompt);
      text.textContent = PLACEHOLDER;
      composer.classList.add("is-waiting");
      await wait(runDuration(prompt));
    }
  })();
}

start();
