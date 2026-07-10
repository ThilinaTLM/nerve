// Node-safe helpers shared between the Electron main process and the
// `bin.ts` launcher. This module must not import Electron so it can run in a
// plain Node context (for example under `npx @nervekit/desktop-shell`).

export type ElectronFontRenderHinting =
  | "system"
  | "none"
  | "slight"
  | "medium"
  | "full";

export function parseElectronFontRenderHinting(
  value: string | undefined,
): ElectronFontRenderHinting | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (
    normalized === "system" ||
    normalized === "none" ||
    normalized === "slight" ||
    normalized === "medium" ||
    normalized === "full"
  ) {
    return normalized;
  }
  console.warn(
    `Ignoring invalid NERVE_ELECTRON_FONT_RENDER_HINTING=${JSON.stringify(value)}. Expected system, none, slight, medium, or full.`,
  );
  return undefined;
}

export function resolveElectronFontRenderHinting(
  value: string | undefined,
  platform: NodeJS.Platform = process.platform,
): ElectronFontRenderHinting | undefined {
  if (platform !== "linux") return undefined;
  return parseElectronFontRenderHinting(value) ?? "slight";
}
