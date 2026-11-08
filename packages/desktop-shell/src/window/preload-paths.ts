import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nativeTheme } from "../platform/electron/electron-api.js";
import {
  appIconAssetSegments,
  trayIconAssetSegments,
} from "./desktop-asset-names.js";

/**
 * Nearest ancestor directory containing a package.json. Both the tsc layout
 * (dist/window/*.js) and the release bundle (dist/*.js) sit under the package
 * root, so assets resolve identically in either.
 */
function resolvePackageRoot(): string {
  let directory = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(directory, "package.json"))) {
    const parent = dirname(directory);
    if (parent === directory)
      throw new Error("Could not locate the desktop package root.");
    directory = parent;
  }
  return directory;
}

export function resolvePreloadPath(): string {
  return join(resolvePackageRoot(), "dist", "preload.cjs");
}

export function resolveAppIconPath(): string {
  return resolveDesktopAssetPath(...appIconAssetSegments(process.platform));
}

export function resolveTrayIconPath(): string {
  return resolveDesktopAssetPath(
    ...trayIconAssetSegments(process.platform, nativeTheme.shouldUseDarkColors),
  );
}

function resolveDesktopAssetPath(...segments: string[]): string {
  return join(resolvePackageRoot(), ...segments);
}
