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
  const targets = [...document.querySelectorAll<HTMLElement>("[data-reveal]")];
  if (reduceMotion() || !("IntersectionObserver" in window)) return;

  const reveal = (element: HTMLElement): void => {
    const delay = Math.min(Number(element.dataset.revealDelay) || 0, 320);
    if (delay) element.style.setProperty("--reveal-delay", `${delay}ms`);

    /* A container may stagger its own children from this single entry. Keep
     * the final child inside a short, predictable completion window. */
    const stagger = Math.min(Number(element.dataset.revealStagger) || 0, 70);
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
  };

  /* Anything already in or just below the viewport resolves before the root
   * marker is installed, avoiding a first-frame flash on initial load. */
  const pending: HTMLElement[] = [];
  for (const target of targets) {
    const rect = target.getBoundingClientRect();
    if (rect.bottom >= 0 && rect.top <= window.innerHeight * 1.12)
      reveal(target);
    else pending.push(target);
  }

  document.documentElement.dataset.motionReady = "true";

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const element = entry.target as HTMLElement;
        reveal(element);
        observer.unobserve(element);
      }
    },
    { threshold: 0.01, rootMargin: "0px 0px 12% 0px" },
  );

  for (const target of pending) observer.observe(target);

  matchMedia("(prefers-reduced-motion: reduce)").addEventListener(
    "change",
    (event) => {
      if (!event.matches) return;
      observer.disconnect();
      delete document.documentElement.dataset.motionReady;
      for (const target of targets) target.classList.add("is-revealed");
    },
    { once: true },
  );
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
