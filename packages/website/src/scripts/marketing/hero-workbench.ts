/* Hero workbench art: plays the run for each prompt the hero composer sends.
 *
 * The chat's transcript is replaced by the prompt bubble, then each tool call
 * appears running and settles done (sub-agent groups settle one by one), then
 * the reply. When the run ends, the card it produced reacts: the docked
 * panel (with the Forge impulse), the pull request, the Jira issue, or a push
 * notification carrying the app's title for that outcome.
 *
 * The markup renders the first run finished, so the art reads the same
 * without script.
 */

import {
  AGENTS_MS,
  type HeroPrompt,
  type HeroStep,
  STEP_MS,
} from "./hero-prompts";

const LIT_MS = 2200;

function element(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/* Appends with a one-frame delay on the settled class so the row eases in. */
function enter(parent: HTMLElement, node: HTMLElement): void {
  node.classList.add("is-entering");
  parent.append(node);
  requestAnimationFrame(() =>
    requestAnimationFrame(() => node.classList.remove("is-entering")),
  );
}

function statusMark(): HTMLElement {
  return element("span", "wb-status");
}

function stepRow(step: Exclude<HeroStep, { agents: readonly string[] }>) {
  const row = element("div", "wb-step is-running");
  row.append(statusMark(), element("code", "", step.tool));
  row.append(element("span", "wb-step-detail", step.detail));
  return row;
}

function agentsRow(names: readonly string[]) {
  const row = element("div", "wb-agents");
  for (const name of names) {
    const agent = element("span", "wb-agent is-running");
    agent.append(statusMark(), element("span", "", `developer · ${name}`));
    row.append(agent);
  }
  return row;
}

function start(): void {
  const art = document.querySelector<HTMLElement>("[data-hero-workbench]");
  const transcript = art?.querySelector<HTMLElement>("[data-wb-transcript]");
  const profile = art?.querySelector<HTMLElement>("[data-wb-profile]");
  const pushTitle = art?.querySelector<HTMLElement>("[data-wb-push-title]");
  const pushBody = art?.querySelector<HTMLElement>("[data-wb-push-body]");
  if (!art || !transcript || !profile || !pushTitle || !pushBody) return;

  const cards = {
    dock: art.querySelector<HTMLElement>("[data-wb-card='dock']"),
    pr: art.querySelector<HTMLElement>("[data-wb-card='pr']"),
    jira: art.querySelector<HTMLElement>("[data-wb-card='jira']"),
    push: art.querySelector<HTMLElement>("[data-wb-card='push']"),
  };

  let run = 0;
  const sleep = (ms: number, token: number) =>
    new Promise<boolean>((resolve) =>
      setTimeout(() => resolve(token === run), ms),
    );

  const light = (card: HTMLElement | null) => {
    if (!card) return;
    card.classList.remove("is-lit");
    void card.offsetWidth;
    card.classList.add("is-lit");
    setTimeout(() => card.classList.remove("is-lit"), LIT_MS);
  };

  const play = async (prompt: HeroPrompt) => {
    const token = ++run;
    art.dataset.profile = prompt.profile;
    profile.textContent = prompt.label;
    art.classList.remove("is-firing");
    transcript.replaceChildren();
    enter(transcript, element("div", "wb-bubble", prompt.text));

    for (const step of prompt.steps) {
      if ("agents" in step) {
        const row = agentsRow(step.agents);
        enter(transcript, row);
        const agents = [...row.children];
        for (const agent of agents) {
          if (!(await sleep(AGENTS_MS / agents.length, token))) return;
          agent.classList.replace("is-running", "is-done");
        }
        continue;
      }
      const row = stepRow(step);
      enter(transcript, row);
      if (!(await sleep(STEP_MS, token))) return;
      row.classList.replace("is-running", "is-done");
    }

    enter(transcript, element("p", "wb-reply", prompt.reply));
    pushTitle.textContent = prompt.push;
    pushBody.textContent = `aurora · ${prompt.title}`;
    light(cards.push);
    if (prompt.effect === "dock") {
      void art.offsetWidth;
      art.classList.add("is-firing");
    }
    if (prompt.effect !== "push") light(cards[prompt.effect]);
  };

  window.addEventListener("nerve:hero-prompt", (event) => {
    void play((event as CustomEvent<HeroPrompt>).detail);
  });
}

start();
