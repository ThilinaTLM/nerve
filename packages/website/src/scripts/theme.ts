/* Theme preference handling for marketing pages.
 *
 * Deliberately mirrors Starlight's contract (`localStorage["starlight-theme"]`
 * holding "light" | "dark" | "" for auto, resolved onto
 * `document.documentElement.dataset.theme`) so a choice made on the homepage
 * carries into the documentation and back. */

export type Theme = "auto" | "dark" | "light";

const storageKey = "starlight-theme";
/* Presentation order of the segmented control; also drives its indicator. */
const order: Theme[] = ["light", "dark", "auto"];

const parseTheme = (value: unknown): Theme =>
  value === "auto" || value === "dark" || value === "light" ? value : "auto";

export const loadTheme = (): Theme => {
  try {
    return parseTheme(localStorage.getItem(storageKey));
  } catch {
    return "auto";
  }
};

const storeTheme = (theme: Theme): void => {
  try {
    localStorage.setItem(
      storageKey,
      theme === "light" || theme === "dark" ? theme : "",
    );
  } catch {
    /* Private mode or blocked storage: the theme still applies for this page. */
  }
};

const preferredScheme = (): Exclude<Theme, "auto"> =>
  matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";

export const resolveTheme = (theme: Theme): Exclude<Theme, "auto"> =>
  theme === "auto" ? preferredScheme() : theme;

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = resolveTheme(theme);
  document.documentElement.dataset.themePreference = theme;
  storeTheme(theme);
  document.dispatchEvent(
    new CustomEvent("theme:change", { detail: { theme: resolveTheme(theme) } }),
  );

  for (const control of document.querySelectorAll<HTMLElement>(
    "[data-theme-switch]",
  )) {
    control.style.setProperty("--switch-index", String(order.indexOf(theme)));
    for (const option of control.querySelectorAll<HTMLElement>(
      "[data-theme-option]",
    )) {
      option.setAttribute(
        "aria-pressed",
        String(option.dataset.themeOption === theme),
      );
    }
  }
}

export function initTheme(): void {
  applyTheme(loadTheme());

  matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (loadTheme() === "auto") applyTheme("auto");
  });

  for (const option of document.querySelectorAll<HTMLElement>(
    "[data-theme-option]",
  )) {
    option.addEventListener("click", () =>
      applyTheme(parseTheme(option.dataset.themeOption)),
    );
  }
}
