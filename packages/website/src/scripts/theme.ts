/* Theme preference handling for marketing pages.
 *
 * Deliberately mirrors Starlight's contract (`localStorage["starlight-theme"]`
 * holding "light" | "dark" | "" for auto, resolved onto
 * `document.documentElement.dataset.theme`) so a choice made on the homepage
 * carries into the documentation and back. */

export type Theme = "auto" | "dark" | "light";

const storageKey = "starlight-theme";
const order: Theme[] = ["dark", "light", "auto"];

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

export const nextTheme = (theme: Theme): Theme =>
  order[(order.indexOf(theme) + 1) % order.length] ?? "auto";

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = resolveTheme(theme);
  document.documentElement.dataset.themePreference = theme;
  storeTheme(theme);
  for (const toggle of document.querySelectorAll<HTMLElement>(
    "[data-theme-toggle]",
  )) {
    toggle.dataset.state = theme;
    toggle.setAttribute("aria-label", `Color theme: ${theme}. Change theme.`);
  }
}

export function initTheme(): void {
  applyTheme(loadTheme());

  matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (loadTheme() === "auto") applyTheme("auto");
  });

  for (const toggle of document.querySelectorAll<HTMLElement>(
    "[data-theme-toggle]",
  )) {
    toggle.addEventListener("click", () => applyTheme(nextTheme(loadTheme())));
  }
}
