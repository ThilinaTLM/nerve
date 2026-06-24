import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, rm, rmdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktopPackageDir = join(repoRoot, "packages", "desktop");
const iconBuildDir = join(desktopPackageDir, "build", "icons");
const iconSizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

const options = parseArgs(process.argv.slice(2));

if (options.command === "install") {
  await install();
} else if (options.command === "uninstall") {
  await uninstall();
} else {
  throw new Error(
    `Unknown command ${options.command}. Use install or uninstall.`,
  );
}

async function install() {
  if (process.platform === "linux") {
    await installLinux();
    return;
  }

  if (process.platform === "win32") {
    await installWindows();
    return;
  }

  throw unsupportedPlatformError("install");
}

async function uninstall() {
  if (process.platform === "linux") {
    await uninstallLinux();
    return;
  }

  if (process.platform === "win32") {
    await uninstallWindows();
    return;
  }

  throw unsupportedPlatformError("uninstall");
}

async function installLinux() {
  const paths = linuxPaths();
  ensureGeneratedIcons();

  await mkdir(paths.binHome, { recursive: true });
  await mkdir(paths.applicationsDir, { recursive: true });

  await writeFile(
    paths.launcherPath,
    `#!/usr/bin/env sh
set -eu
cd ${shellQuote(repoRoot)}
exec ${shellQuote(options.pnpm)} desktop
`,
  );
  await chmod(paths.launcherPath, 0o755);

  for (const size of iconSizes) {
    const iconDir = join(paths.hicolorDir, `${size}x${size}`, "apps");
    await mkdir(iconDir, { recursive: true });
    await copyFile(
      join(iconBuildDir, `${size}x${size}.png`),
      join(iconDir, "nerve.png"),
    );
  }

  await writeFile(
    paths.desktopPath,
    `[Desktop Entry]
Version=1.0
Type=Application
Name=Nerve
GenericName=AI coding harness
Comment=UI-first personal AI coding harness.
Exec=${desktopExecQuote(paths.launcherPath)}
TryExec=${desktopStringValue(paths.launcherPath)}
Icon=nerve
Terminal=false
Categories=Development;
StartupNotify=true
StartupWMClass=nerve
Keywords=AI;Coding;Agent;Developer;Nerve;
`,
  );

  await removeLegacyLinuxDevInstall(paths);
  refreshLinuxDesktopCaches(paths);

  console.log(`Installed Nerve launcher: ${paths.desktopPath}`);
  console.log(`Installed launcher script: ${paths.launcherPath}`);
  console.log(`Installed icons under: ${paths.hicolorDir}`);
}

async function uninstallLinux() {
  const paths = linuxPaths();

  await rm(paths.desktopPath, { force: true });
  await rm(paths.launcherPath, { force: true });

  for (const size of iconSizes) {
    await rm(join(paths.hicolorDir, `${size}x${size}`, "apps", "nerve.png"), {
      force: true,
    });
  }

  await removeLegacyLinuxDevInstall(paths);
  refreshLinuxDesktopCaches(paths);

  console.log(`Removed Nerve desktop entry: ${paths.desktopPath}`);
  console.log(`Removed launcher script: ${paths.launcherPath}`);
  console.log("Removed user-space Nerve icons.");
}

async function installWindows() {
  const paths = windowsPaths();

  await mkdir(paths.installDir, { recursive: true });
  await mkdir(paths.startMenuDir, { recursive: true });

  const launcherBody = [
    "@echo off",
    "setlocal",
    `cd /d ${cmdQuote(repoRoot)}`,
    `${cmdQuote(options.pnpm)} desktop %*`,
    "",
  ].join("\r\n");

  await writeFile(paths.launcherPath, launcherBody);

  createWindowsShortcut(paths);

  console.log(`Installed Nerve launcher: ${paths.shortcutPath}`);
  console.log(`Installed launcher script: ${paths.launcherPath}`);
}

async function uninstallWindows() {
  const paths = windowsPaths();

  await rm(paths.shortcutPath, { force: true });
  await rm(paths.launcherPath, { force: true });
  await removeEmptyDirectory(paths.installDir);

  console.log(`Removed Nerve Start Menu shortcut: ${paths.shortcutPath}`);
  console.log(`Removed launcher script: ${paths.launcherPath}`);
}

async function removeLegacyLinuxDevInstall(paths) {
  await rm(paths.legacyDesktopPath, { force: true });
  await rm(paths.legacyLauncherPath, { force: true });
  for (const size of iconSizes) {
    await rm(
      join(paths.hicolorDir, `${size}x${size}`, "apps", "nerve-dev.png"),
      {
        force: true,
      },
    );
  }
}

async function removeEmptyDirectory(path) {
  try {
    await rmdir(path);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error.code === "ENOENT" ||
        error.code === "ENOTEMPTY" ||
        error.code === "EEXIST")
    ) {
      return;
    }
    throw error;
  }
}

function parseArgs(args) {
  const command = args[0] || "install";
  const parsed = { command, pnpm: "pnpm" };

  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--pnpm") {
      const pnpm = args[index + 1];
      if (!pnpm) throw new Error("Missing value for --pnpm.");
      parsed.pnpm = pnpm;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument ${arg}.`);
  }

  return parsed;
}

function linuxPaths() {
  const home = process.env.HOME;
  if (!home) {
    throw new Error("HOME is not set; cannot manage a user desktop entry.");
  }

  const xdgDataHome =
    process.env.XDG_DATA_HOME || join(home, ".local", "share");
  const binHome = process.env.XDG_BIN_HOME || join(home, ".local", "bin");
  const applicationsDir = join(xdgDataHome, "applications");
  const hicolorDir = join(xdgDataHome, "icons", "hicolor");

  return {
    applicationsDir,
    binHome,
    desktopPath: join(applicationsDir, "nerve.desktop"),
    hicolorDir,
    launcherPath: join(binHome, "nerve-desktop"),
    legacyDesktopPath: join(applicationsDir, "nerve-dev.desktop"),
    legacyLauncherPath: join(binHome, "nerve-desktop-dev"),
  };
}

function windowsPaths() {
  const localAppData = windowsUserPath("LOCALAPPDATA", "Local");
  const appData = windowsUserPath("APPDATA", "Roaming");
  const installDir = join(localAppData, "Nerve");
  const startMenuDir = join(
    appData,
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
  );

  return {
    installDir,
    launcherPath: join(installDir, "nerve-desktop.cmd"),
    shortcutPath: join(startMenuDir, "Nerve.lnk"),
    startMenuDir,
  };
}

function windowsUserPath(envName, appDataSubdir) {
  const envValue = process.env[envName];
  if (envValue) return envValue;

  const userHome = homedir();
  if (!userHome) {
    throw new Error(`${envName} is not set and the user home is unavailable.`);
  }

  return join(userHome, "AppData", appDataSubdir);
}

function ensureGeneratedIcons() {
  for (const size of iconSizes) {
    const source = join(iconBuildDir, `${size}x${size}.png`);
    if (!existsSync(source)) {
      throw new Error(
        `Missing generated icon ${source}. Run pnpm --filter @nervekit/desktop icons first.`,
      );
    }
  }
}

function createWindowsShortcut(paths) {
  const script = `
$shortcutPath = ${psQuote(paths.shortcutPath)}
$targetPath = ${psQuote(paths.launcherPath)}
$workingDirectory = ${psQuote(repoRoot)}
$description = 'Nerve desktop development launcher'
$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $targetPath
$shortcut.WorkingDirectory = $workingDirectory
$shortcut.Description = $description
$shortcut.Save()
`;
  const encodedScript = Buffer.from(script, "utf16le").toString("base64");
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      encodedScript,
    ],
    { encoding: "utf8" },
  );

  if (result.error) {
    throw new Error(
      `Failed to create Windows shortcut ${paths.shortcutPath}: ${result.error.message}`,
    );
  }

  if (result.status !== 0) {
    throw new Error(
      `Failed to create Windows shortcut ${paths.shortcutPath}.\n${result.stderr || result.stdout}`,
    );
  }
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function desktopExecQuote(value) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function desktopStringValue(value) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\t", "\\t");
}

function cmdQuote(value) {
  return `"${value.replaceAll("%", "%%").replaceAll('"', '""')}"`;
}

function psQuote(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function refreshLinuxDesktopCaches(paths) {
  runLinuxCommandIfAvailable("update-desktop-database", [
    paths.applicationsDir,
  ]);
  runLinuxCommandIfAvailable("xdg-desktop-menu", [
    "forceupdate",
    "--mode",
    "user",
  ]);
  runLinuxCommandIfAvailable("kbuildsycoca6", ["--noincremental"]);
  runLinuxCommandIfAvailable("kbuildsycoca5", ["--noincremental"]);
  runLinuxCommandIfAvailable("gtk-update-icon-cache", [
    "-q",
    "-t",
    paths.hicolorDir,
  ]);
  runLinuxCommandIfAvailable("xdg-icon-resource", [
    "forceupdate",
    "--mode",
    "user",
  ]);
}

function runLinuxCommandIfAvailable(commandName, args) {
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

function unsupportedPlatformError(command) {
  return new Error(
    `${command} is supported on Linux and Windows only; current platform is ${process.platform}.`,
  );
}
