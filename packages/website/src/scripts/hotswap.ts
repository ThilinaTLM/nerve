/* The hot-swap lab's controls.
 *
 * Critical-path module on purpose: the lab must respond to clicks with or
 * without the GSAP stage, and under reduced motion `run-sim` answers a change
 * by rendering the whole adjusted turn at once instead of streaming it.
 */

import { startRunSim, type SimConfig } from "./run-sim";

export function initHotSwap(): void {
  const lab = document.querySelector<HTMLElement>("[data-hotswap]");
  if (!lab) return;

  const panel = lab.querySelector<HTMLElement>('[data-run-sim="lab"]');
  if (!panel) return;

  const sim = startRunSim(panel);
  if (!sim) return;

  for (const control of lab.querySelectorAll<HTMLElement>("[data-control]")) {
    const key = control.dataset.control as keyof SimConfig | undefined;
    if (!key) continue;

    const buttons = [
      ...control.querySelectorAll<HTMLButtonElement>(".seg-btn"),
    ];
    for (const button of buttons) {
      button.addEventListener("click", () => {
        if (button.getAttribute("aria-pressed") === "true") return;
        for (const other of buttons) {
          other.setAttribute("aria-pressed", String(other === button));
        }
        sim.setConfig({ [key]: button.dataset.value } as Partial<SimConfig>);
      });
    }
  }
}
