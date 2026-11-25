/* Replays the hero's workbench assembling itself, on a loop.
 *
 * The markup is the finished state. Playing empties every slot, then for each
 * build in `data-builds`: types the request, marks its slot as building, fills
 * it, and shows the result line. After the last build it holds, then starts
 * over. The loop waits while the stage is off screen or the tab is hidden, and
 * never starts under reduced motion.
 */

interface Build {
  slot: string;
  ask: string;
  done: string;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function startForgeStage(root: HTMLElement): void {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const builds = JSON.parse(root.dataset.builds ?? "[]") as Build[];
  const ask = root.querySelector<HTMLElement>("[data-forge-ask]");
  const status = root.querySelector<HTMLElement>("[data-forge-status]");
  const statusText = root.querySelector<HTMLElement>(
    "[data-forge-status-text]",
  );
  if (builds.length === 0 || !ask || !status || !statusText) return;

  let visible = false;
  let wake: (() => void) | undefined;
  const ready = (): boolean => visible && !document.hidden;
  const whenVisible = (): Promise<void> =>
    ready()
      ? Promise.resolve()
      : new Promise((resolve) => {
          wake = resolve;
        });
  const update = (): void => {
    if (ready() && wake) {
      wake();
      wake = undefined;
    }
  };

  new IntersectionObserver(
    ([entry]) => {
      visible = Boolean(entry?.isIntersecting);
      update();
    },
    { threshold: 0.2 },
  ).observe(root);
  document.addEventListener("visibilitychange", update);

  /* Waits `ms`, pausing while the stage is out of view. */
  const wait = async (ms: number): Promise<void> => {
    await whenVisible();
    await sleep(ms);
  };

  const slot = (name: string): HTMLElement | null =>
    root.querySelector<HTMLElement>(`[data-slot="${name}"]`);

  const type = async (text: string): Promise<void> => {
    for (let index = 1; index <= text.length; index += 1) {
      ask.textContent = text.slice(0, index);
      await wait(text[index - 1] === " " ? 30 : 19);
    }
  };

  const play = async (): Promise<void> => {
    await whenVisible();
    root.dataset.playing = "";
    for (;;) {
      for (const element of root.querySelectorAll<HTMLElement>("[data-slot]")) {
        delete element.dataset.filled;
        delete element.dataset.building;
      }
      await wait(700);

      for (const build of builds) {
        const target = slot(build.slot);
        status.dataset.state = "typing";
        ask.textContent = "";
        await type(build.ask);
        await wait(350);

        status.dataset.state = "building";
        statusText.textContent = "Building…";
        if (target) target.dataset.building = "";
        await wait(1100);

        if (target) {
          delete target.dataset.building;
          target.dataset.filled = "";
        }
        delete status.dataset.state;
        statusText.textContent = build.done;
        await wait(1500);
      }

      await wait(4000);
    }
  };

  void play();
}
