/* Marketing page behaviour.
 *
 * This module is the critical path: theme, sticky header state, copy buttons,
 * the mobile carousel, and pointer tilt. It is small, has no dependencies
 * beyond this package, and everything it does works on markup that is already
 * complete.
 *
 * The choreography — masked headline reveals, the pinned anatomy timeline, the
 * conducting diagrams — lives behind a dynamic import of `stage/index`, so the
 * animation engine is never on the path to a readable page. Under
 * `prefers-reduced-motion: reduce` it is never fetched at all.
 *
 * `MarketingLayout` sets `html[data-motion-ready]` before first paint when
 * motion is allowed, which arms the pre-hidden reveal state in `motion.css`,
 * and clears it again if the stage has not reported in. Content can therefore
 * never be stranded hidden by a failed or slow module.
 */

import { initCarousels } from "./carousel";
import { initTheme } from "./theme";
import { initTilt } from "./tilt";

const reduceMotion = (): boolean =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;

function initHeader(): void {
  const header = document.querySelector<HTMLElement>("[data-site-header]");
  if (!header) return;

  const sync = (): void => {
    header.dataset.scrolled = String(window.scrollY > 24);
  };
  sync();
  window.addEventListener("scroll", sync, { passive: true });
}

function initCopyButtons(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-copy]",
  )) {
    const value = button.dataset.copy ?? "";
    const status =
      button.parentElement?.querySelector<HTMLElement>("[data-copy-status]");
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(value);
        button.dataset.copied = "true";
        if (status) status.textContent = "Copied to clipboard";
        setTimeout(() => {
          delete button.dataset.copied;
          if (status) status.textContent = "";
        }, 1600);
      } catch {
        if (status)
          status.textContent = "Copy failed. Select the text instead.";
      }
    });
  }
}

function initStage(): void {
  if (reduceMotion()) {
    delete document.documentElement.dataset.motionReady;
    return;
  }

  void import("./stage/index")
    .then((module) => module.initStage())
    .catch(() => {
      /* The page is complete without it; just stop pre-hiding reveals. */
      delete document.documentElement.dataset.motionReady;
    });
}

function init(): void {
  initTheme();
  initHeader();
  initCopyButtons();
  initCarousels();
  initTilt();
  initStage();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
