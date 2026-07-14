export function appIconAssetSegments(
  platform: NodeJS.Platform,
): readonly string[] {
  return platform === "win32"
    ? ["build", "windows", "app.ico"]
    : ["build", "icons", "512x512.png"];
}

export function trayIconAssetSegments(
  platform: NodeJS.Platform,
  shouldUseDarkColors: boolean,
): readonly string[] {
  if (platform === "darwin") {
    return ["build", "tray", "macos", "nerveTemplate.png"];
  }

  const name = shouldUseDarkColors ? "tray-dark" : "tray-light";
  return platform === "win32"
    ? ["build", "tray", "windows", `${name}.ico`]
    : ["build", "tray", "linux", `${name}.png`];
}
