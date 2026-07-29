/* Marketing page behaviour: scroll reveals, sticky header state, copy buttons,
 * and the theme switch.
 *
 * Scroll-linked choreography lives in `scroll-stage.ts` and pointer tilt lives
 * in `tilt.ts`. Nothing here is required for the page to be readable: reveals
 * resolve to visible when observation is unavailable, and every other feature
 * is an enhancement on already-correct markup.
 */

import { initScrollStages } from "./scroll-stage";
import { initTheme } from "./theme";
import { initTilt } from "./tilt";

const reduceMotion = (): boolean =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;

function initReveals(): void {
  const targets = document.querySelectorAll<HTMLElement>("[data-reveal]");
  if (reduceMotion() || !("IntersectionObserver" in window)) {
    for (const target of targets) target.classList.add("is-revealed");
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const element = entry.target as HTMLElement;
        const delay = element.dataset.revealDelay;
        if (delay) element.style.setProperty("--reveal-delay", `${delay}ms`);

        /* A container may stagger its own children from this single entry
         * instead of registering an observer per child. */
        const stagger = Number(element.dataset.revealStagger);
        if (stagger) {
          const children = element.querySelectorAll<HTMLElement>(
            "[data-reveal-child]",
          );
          for (const [index, child] of children.entries()) {
            child.style.setProperty("--reveal-delay", `${index * stagger}ms`);
            child.classList.add("is-revealed");
          }
        }

        element.classList.add("is-revealed");
        observer.unobserve(element);
      }
    },
    { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
  );

  for (const target of targets) observer.observe(target);
}

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

function init(): void {
  initTheme();
  initReveals();
  initHeader();
  initCopyButtons();
  initTilt();
  initScrollStages();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
