import { bridgeEvents, themeTokenNames } from "@nervekit/contracts/extensions";

const maxTokensCssLength = 8192;

/**
 * The `--token:value;` declarations of the theme currently applied to the app, read from the
 * document so built-in and extension themes are treated alike. Frames put them in a `:root`
 * rule to match the host.
 */
export function themeTokensSnapshot(
  read: (property: string) => string,
): string {
  const css = themeTokenNames
    .flatMap((name) => {
      const value = read(`--${name}`).trim();
      return value && !/[;{}<]/.test(value) ? [`--${name}:${value};`] : [];
    })
    .join("");
  return css.length <= maxTokensCssLength ? css : "";
}

export type ThemeSnapshot = {
  kind: "light" | "dark";
  tokensCss: string;
};

export function currentThemeSnapshot(root: HTMLElement): ThemeSnapshot {
  const style = getComputedStyle(root);
  const snapshot: ThemeSnapshot = {
    kind: root.classList.contains("dark") ? "dark" : "light",
    tokensCss: themeTokensSnapshot((property) =>
      style.getPropertyValue(property),
    ),
  };
  return bridgeEvents["theme.changed"].parse(snapshot);
}
