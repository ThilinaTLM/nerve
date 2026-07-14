#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { access, readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ID = "io.github.thilinatlm.nerve";
const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const desktopRoot = join(repoRoot, "packages", "desktop-shell");
const buildRoot = join(desktopRoot, "build");
const releaseRoot = join(desktopRoot, "release");

await validateGeneratedAssets();
await validatePackagedBundle();
console.log(`Desktop package smoke passed on ${process.platform}.`);

async function validateGeneratedAssets() {
  await access(join(buildRoot, "icon.svg"));

  await assertPngSize(
    join(buildRoot, "tray", "macos", "nerveTemplate.png"),
    16,
  );
  await assertPngSize(
    join(buildRoot, "tray", "macos", "nerveTemplate@2x.png"),
    32,
  );
  await assertPngSize(join(buildRoot, "tray", "linux", "tray-light.png"), 32);
  await assertPngSize(
    join(buildRoot, "tray", "linux", "tray-light@2x.png"),
    64,
  );
  await assertPngSize(join(buildRoot, "tray", "linux", "tray-dark.png"), 32);
  await assertPngSize(join(buildRoot, "tray", "linux", "tray-dark@2x.png"), 64);

  await assertIcoSizes(
    join(buildRoot, "windows", "app.ico"),
    [16, 20, 24, 32, 40, 48, 64, 256],
  );
  await assertIcoSizes(
    join(buildRoot, "tray", "windows", "tray-light.ico"),
    [16, 20, 24, 32],
  );
  await assertIcoSizes(
    join(buildRoot, "tray", "windows", "tray-dark.ico"),
    [16, 20, 24, 32],
  );
}

async function validatePackagedBundle() {
  if (process.platform === "darwin") {
    await validateMacosBundle();
    return;
  }
  if (process.platform === "win32") {
    await validateWindowsBundle();
    return;
  }
  if (process.platform === "linux") {
    await validateLinuxBundle();
    return;
  }
  throw new Error(
    `Unsupported desktop package smoke platform ${process.platform}`,
  );
}

async function validateLinuxBundle() {
  const bundleRoot = await findDirectory(releaseRoot, /^linux.*-unpacked$/);
  await assertFile(join(bundleRoot, "nerve-desktop"));
  await validateUnpackedRuntimeAssets(
    join(bundleRoot, "resources", "app.asar.unpacked", "build"),
    [
      ["icons", "512x512.png"],
      ["tray", "linux", "tray-light.png"],
      ["tray", "linux", "tray-dark.png"],
    ],
  );
}

async function validateWindowsBundle() {
  const bundleRoot = await findDirectory(releaseRoot, /^win.*-unpacked$/);
  const executable = join(bundleRoot, "nerve-desktop.exe");
  await assertFile(executable);
  await validateUnpackedRuntimeAssets(
    join(bundleRoot, "resources", "app.asar.unpacked", "build"),
    [
      ["windows", "app.ico"],
      ["tray", "windows", "tray-light.ico"],
      ["tray", "windows", "tray-dark.ico"],
    ],
  );

  const script = [
    "Add-Type -AssemblyName System.Drawing",
    `$icon = [System.Drawing.Icon]::ExtractAssociatedIcon('${executable.replaceAll("'", "''")}')`,
    "if ($null -eq $icon) { exit 1 }",
    "$icon.Dispose()",
  ].join("\n");
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
    { encoding: "utf8" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      result.stderr || "Packaged Windows executable has no associated icon",
    );
  }
}

async function validateMacosBundle() {
  const appBundle = await findNestedDirectory(releaseRoot, (name) =>
    name.endsWith(".app"),
  );
  const contents = join(appBundle, "Contents");
  const infoPlist = join(contents, "Info.plist");
  await assertFile(infoPlist);

  const plistResult = spawnSync(
    "plutil",
    ["-extract", "CFBundleIdentifier", "raw", "-o", "-", infoPlist],
    { encoding: "utf8" },
  );
  if (plistResult.error) throw plistResult.error;
  if (plistResult.status !== 0 || plistResult.stdout.trim() !== APP_ID) {
    throw new Error(
      plistResult.stderr ||
        `Unexpected macOS bundle identifier ${JSON.stringify(plistResult.stdout.trim())}`,
    );
  }

  const resources = join(contents, "Resources");
  await findNestedFile(resources, (name) => name.endsWith(".icns"));
  await validateUnpackedRuntimeAssets(
    join(resources, "app.asar.unpacked", "build"),
    [
      ["tray", "macos", "nerveTemplate.png"],
      ["tray", "macos", "nerveTemplate@2x.png"],
    ],
  );
}

async function validateUnpackedRuntimeAssets(root, paths) {
  for (const segments of paths) await assertFile(join(root, ...segments));
}

async function assertPngSize(path, expectedSize) {
  const image = await readFile(path);
  const pngSignature = "89504e470d0a1a0a";
  if (
    image.length < 24 ||
    image.subarray(0, 8).toString("hex") !== pngSignature
  ) {
    throw new Error(`${path} is not a valid PNG`);
  }
  const width = image.readUInt32BE(16);
  const height = image.readUInt32BE(20);
  if (width !== expectedSize || height !== expectedSize) {
    throw new Error(
      `${path} is ${width}x${height}; expected ${expectedSize}x${expectedSize}`,
    );
  }
}

async function assertIcoSizes(path, expectedSizes) {
  const icon = await readFile(path);
  if (
    icon.length < 6 ||
    icon.readUInt16LE(0) !== 0 ||
    icon.readUInt16LE(2) !== 1
  ) {
    throw new Error(`${path} is not a valid ICO`);
  }

  const count = icon.readUInt16LE(4);
  const sizes = [];
  for (let index = 0; index < count; index += 1) {
    const offset = 6 + index * 16;
    if (offset + 16 > icon.length)
      throw new Error(`${path} has a truncated ICO directory`);
    const width = icon[offset] || 256;
    const height = icon[offset + 1] || 256;
    if (width !== height)
      throw new Error(`${path} contains a non-square ICO frame`);
    sizes.push(width);
  }

  if (sizes.join(",") !== expectedSizes.join(",")) {
    throw new Error(
      `${path} contains ICO sizes [${sizes.join(", ")}]; expected [${expectedSizes.join(", ")}]`,
    );
  }
}

async function findDirectory(root, pattern) {
  const entries = await readdir(root, { withFileTypes: true });
  const entry = entries.find(
    (candidate) => candidate.isDirectory() && pattern.test(candidate.name),
  );
  if (!entry) throw new Error(`No directory matching ${pattern} under ${root}`);
  return join(root, entry.name);
}

async function findNestedDirectory(root, predicate) {
  const result = await findNested(root, predicate, true);
  if (!result)
    throw new Error(`Expected directory was not found under ${root}`);
  return result;
}

async function findNestedFile(root, predicate) {
  const result = await findNested(root, predicate, false);
  if (!result) throw new Error(`Expected file was not found under ${root}`);
  return result;
}

async function findNested(root, predicate, directory) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory() === directory && predicate(entry.name)) return path;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const result = await findNested(
      join(root, entry.name),
      predicate,
      directory,
    );
    if (result) return result;
  }
  return undefined;
}

async function assertFile(path) {
  await access(path);
  const metadata = await stat(path);
  if (!metadata.isFile()) throw new Error(`${path} is not a file`);
}
