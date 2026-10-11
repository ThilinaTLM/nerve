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

export interface StartupSplashView {
  status: string;
  detail?: string;
  meter?: { done: number; total: number; fraction: number };
}

/**
 * Mirrors server lifecycle progress into the splash painted by index.html.
 * Returns false once the splash is gone.
 */
export function updateStartupSplash(view: StartupSplashView): boolean {
  const status = document.getElementById("startup-splash-status");
  if (!status) return false;
  if (status.textContent !== view.status) {
    status.classList.remove("is-swapping");
    void status.offsetWidth;
    status.textContent = view.status;
    status.classList.add("is-swapping");
  }
  const detail = document.getElementById("startup-splash-detail");
  if (detail) {
    detail.textContent = view.detail ?? "";
    detail.hidden = !view.detail;
  }
  const meter = document.getElementById("startup-splash-meter");
  const fill = document.getElementById("startup-splash-fill");
  if (meter && fill) {
    if (view.meter) {
      meter.setAttribute("aria-valuemin", "0");
      meter.setAttribute("aria-valuemax", String(view.meter.total));
      meter.setAttribute("aria-valuenow", String(view.meter.done));
      fill.style.animation = "none";
      fill.style.transform = `scaleX(${view.meter.fraction})`;
    } else {
      meter.removeAttribute("aria-valuenow");
      fill.style.animation = "";
      fill.style.transform = "";
    }
  }
  return true;
}
