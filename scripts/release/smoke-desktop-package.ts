#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { repoRoot } from "../workspace/repo.ts";

const desktopRoot = join(repoRoot, "packages", "desktop-shell");
const buildRoot = join(desktopRoot, "build");

await validateGeneratedAssets();
console.log(`Desktop asset smoke passed on ${process.platform}.`);

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

async function assertPngSize(path: string, expectedSize: number) {
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

async function assertIcoSizes(path: string, expectedSizes: number[]) {
  const icon = await readFile(path);
  if (
    icon.length < 6 ||
    icon.readUInt16LE(0) !== 0 ||
    icon.readUInt16LE(2) !== 1
  ) {
    throw new Error(`${path} is not a valid ICO`);
  }

  const count = icon.readUInt16LE(4);
  const sizes: number[] = [];
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
