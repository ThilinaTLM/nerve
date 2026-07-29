/* Marketing motion: scroll reveals, pointer spotlight, parallax, sticky header
 * state, the transcript demo schedule, and the copy button.
 *
 * No dependencies, no layout-affecting animation, and every effect degrades to
 * fully visible static content when motion is reduced or JavaScript is absent. */

import { initTheme } from "./theme";

const reduceMotion = (): boolean =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;

const coarsePointer = (): boolean => matchMedia("(pointer: coarse)").matches;

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
        element.classList.add("is-revealed");
        observer.unobserve(element);
      }
    },
    { threshold: 0.16, rootMargin: "0px 0px -8% 0px" },
  );

  for (const target of targets) observer.observe(target);
}

function initSpotlight(): void {
  if (reduceMotion() || coarsePointer()) return;

  for (const card of document.querySelectorAll<HTMLElement>(
    "[data-spotlight]",
  )) {
    let frame = 0;
    card.addEventListener("pointermove", (event) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const rect = card.getBoundingClientRect();
        card.style.setProperty(
          "--spot-x",
          `${((event.clientX - rect.left) / rect.width) * 100}%`,
        );
        card.style.setProperty(
          "--spot-y",
          `${((event.clientY - rect.top) / rect.height) * 100}%`,
        );
      });
    });
    card.addEventListener("pointerleave", () => {
      card.style.removeProperty("--spot-x");
      card.style.removeProperty("--spot-y");
    });
  }
}

function initParallax(): void {
  const targets = [
    ...document.querySelectorAll<HTMLElement>("[data-parallax]"),
  ];
  if (!targets.length || reduceMotion()) return;

  let frame = 0;
  const update = (): void => {
    frame = 0;
    const viewport = window.innerHeight;
    for (const target of targets) {
      const rect = target.getBoundingClientRect();
      const centerOffset =
        (rect.top + rect.height / 2 - viewport / 2) / viewport;
      const strength = Number(target.dataset.parallax) || 18;
      const shift = Math.max(-1, Math.min(1, centerOffset)) * strength;
      target.style.setProperty("--parallax", `${shift.toFixed(2)}px`);
    }
  };

  const schedule = (): void => {
    if (!frame) frame = requestAnimationFrame(update);
  };

  update();
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
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

function initTranscriptDemo(): void {
  const demo = document.querySelector<HTMLElement>("[data-transcript-demo]");
  if (!demo) return;

  const lines = [...demo.querySelectorAll<HTMLElement>(".demo-line")];
  if (!lines.length) return;

  if (reduceMotion() || !("IntersectionObserver" in window)) {
    for (const line of lines) line.style.opacity = "1";
    return;
  }

  // Hide before the demo scrolls into view so the first play streams in
  // instead of blinking out. Without JavaScript the lines stay visible.
  for (const line of lines) line.style.opacity = "0";

  let timers: ReturnType<typeof setTimeout>[] = [];
  const stop = (): void => {
    for (const timer of timers) clearTimeout(timer);
    timers = [];
  };

  const play = (): void => {
    stop();
    for (const line of lines) {
      line.classList.remove("is-live");
      line.style.opacity = "0";
    }
    lines.forEach((line, index) => {
      const step = Number(line.dataset.demoDelay) || 420;
      timers.push(
        setTimeout(
          () => {
            line.style.opacity = "";
            line.classList.add("is-live");
          },
          index * 90 + step,
        ),
      );
    });
    timers.push(setTimeout(play, 9600));
  };

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) play();
        else stop();
      }
    },
    { threshold: 0.35 },
  );
  observer.observe(demo);
}

function init(): void {
  initTheme();
  initReveals();
  initSpotlight();
  initParallax();
  initHeader();
  initCopyButtons();
  initTranscriptDemo();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
