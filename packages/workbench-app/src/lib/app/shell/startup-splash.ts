/** Matches the fade declared in the `startup-splash` block of index.html. */
const DISMISS_DURATION_MS = 280;

/**
 * Removes the startup splash that index.html painted before the bundle loaded.
 * The node lives for the whole boot so the intro never restarts; the workbench
 * paints behind it and this fades the splash away once it is ready.
 */
export function dismissStartupSplash(): void {
  const splash = document.getElementById("startup-splash");
  if (!splash || splash.classList.contains("is-dismissed")) return;

  splash.classList.add("is-complete");
  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  if (reducedMotion) {
    splash.remove();
    return;
  }

  // Two frames: the first commits `is-complete`, the second starts the fade.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      splash.classList.add("is-dismissed");
      window.setTimeout(() => splash.remove(), DISMISS_DURATION_MS);
    });
  });
}
