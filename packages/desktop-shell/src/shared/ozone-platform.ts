// Node-safe helpers shared between the Electron main process and the
// `bin.ts` launcher. This module must not import Electron so it can run in a
// plain Node context (for example under `npx @nervekit/desktop`).

export type ElectronOzonePlatform = "x11" | "wayland" | "auto";

export function parseElectronOzonePlatform(
  value: string | undefined,
): ElectronOzonePlatform | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (
    normalized === "x11" ||
    normalized === "wayland" ||
    normalized === "auto"
  ) {
    return normalized;
  }
  console.warn(
    `Ignoring invalid NERVE_ELECTRON_OZONE_PLATFORM=${JSON.stringify(value)}. Expected x11, wayland, or auto.`,
  );
  return undefined;
}
