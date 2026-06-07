import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktopPackageDir = join(repoRoot, "packages", "desktop");
const iconBuildDir = join(desktopPackageDir, "build", "icons");
const home = process.env.HOME;

if (!home) {
  throw new Error("HOME is not set; cannot manage a user desktop entry.");
}

const xdgDataHome = process.env.XDG_DATA_HOME || join(home, ".local", "share");
const binHome = process.env.XDG_BIN_HOME || join(home, ".local", "bin");
const applicationsDir = join(xdgDataHome, "applications");
const hicolorDir = join(xdgDataHome, "icons", "hicolor");
const launcherPath = join(binHome, "nerve-desktop");
const desktopPath = join(applicationsDir, "nerve.desktop");
const legacyLauncherPath = join(binHome, "nerve-desktop-dev");
const legacyDesktopPath = join(applicationsDir, "nerve-dev.desktop");
const pnpm = process.env.PNPM || "pnpm";

const iconSizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const command = process.argv[2] || "install";

if (command === "install") {
  await install();
} else if (command === "uninstall") {
  await uninstall();
} else {
  throw new Error(`Unknown command ${command}. Use install or uninstall.`);
}

async function install() {
  for (const size of iconSizes) {
    const source = join(iconBuildDir, `${size}x${size}.png`);
    if (!existsSync(source)) {
      throw new Error(
        `Missing generated icon ${source}. Run pnpm --filter @nerve/desktop icons first.`,
      );
    }
  }

  await mkdir(binHome, { recursive: true });
  await mkdir(applicationsDir, { recursive: true });

  await writeFile(
    launcherPath,
    `#!/usr/bin/env sh
set -eu
cd ${shellQuote(repoRoot)}
exec ${shellQuote(pnpm)} desktop
`,
  );
  await chmod(launcherPath, 0o755);

  for (const size of iconSizes) {
    const iconDir = join(hicolorDir, `${size}x${size}`, "apps");
    await mkdir(iconDir, { recursive: true });
    await copyFile(
      join(iconBuildDir, `${size}x${size}.png`),
      join(iconDir, "nerve.png"),
    );
  }

  await writeFile(
    desktopPath,
    `[Desktop Entry]
Version=1.0
Type=Application
Name=Nerve
GenericName=AI coding harness
Comment=UI-first personal AI coding harness.
Exec=${desktopExecQuote(launcherPath)}
TryExec=${desktopExecQuote(launcherPath)}
Icon=nerve
Terminal=false
Categories=Development;
StartupNotify=true
StartupWMClass=nerve
Keywords=AI;Coding;Agent;Developer;Nerve;
`,
  );

  await removeLegacyDevInstall();
  refreshDesktopCaches();

  console.log(`Installed Nerve launcher: ${desktopPath}`);
  console.log(`Installed launcher script: ${launcherPath}`);
  console.log(`Installed icons under: ${hicolorDir}`);
}

async function uninstall() {
  await rm(desktopPath, { force: true });
  await rm(launcherPath, { force: true });

  for (const size of iconSizes) {
    await rm(join(hicolorDir, `${size}x${size}`, "apps", "nerve.png"), {
      force: true,
    });
  }

  await removeLegacyDevInstall();
  refreshDesktopCaches();

  console.log(`Removed Nerve desktop entry: ${desktopPath}`);
  console.log(`Removed launcher script: ${launcherPath}`);
  console.log("Removed user-space Nerve icons.");
}

async function removeLegacyDevInstall() {
  await rm(legacyDesktopPath, { force: true });
  await rm(legacyLauncherPath, { force: true });
  for (const size of iconSizes) {
    await rm(join(hicolorDir, `${size}x${size}`, "apps", "nerve-dev.png"), {
      force: true,
    });
  }
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function desktopExecQuote(value) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function refreshDesktopCaches() {
  runIfAvailable("update-desktop-database", [applicationsDir]);
  runIfAvailable("gtk-update-icon-cache", ["-q", "-t", hicolorDir]);
}

function runIfAvailable(commandName, args) {
  const lookup = spawnSync("sh", ["-c", `command -v ${commandName}`], {
    encoding: "utf8",
  });
  if (lookup.status !== 0) return;

  const result = spawnSync(commandName, args, { stdio: "inherit" });
  if (result.status && result.status !== 0) {
    console.warn(
      `${commandName} exited with status ${result.status}; continuing.`,
    );
  }
}
