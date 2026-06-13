import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, nativeTheme } from "../electron.js";

export function resolvePreloadPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "preload.cjs");
}

export function resolvePackagedWebDistPath(): string | undefined {
  if (!app.isPackaged) return undefined;
  return join(process.resourcesPath, "web-dist");
}

export function resolveAppIconPath(): string {
  return resolveDesktopAssetPath("build", "icons", "512x512.png");
}

export function resolveTrayIconPath(): string {
  const name =
    process.platform === "darwin"
      ? "tray-template.png"
      : nativeTheme.shouldUseDarkColors
        ? "tray-dark.png"
        : "tray-light.png";
  return resolveDesktopAssetPath("build", "tray", name);
}

function resolveDesktopAssetPath(...segments: string[]): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const packageRelativePath = join(moduleDir, "..", "..", ...segments);
  if (existsSync(packageRelativePath)) return packageRelativePath;

  return join(process.resourcesPath, "app.asar.unpacked", ...segments);
}
