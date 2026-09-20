/**
 * Converts captured PNG frames into the published WebP pairs.
 *
 * Refuses incomplete light/dark pairs and unexpected dimensions: a half-updated
 * asset set is worse than an untouched one, because `ThemeScreenshot` renders
 * both variants and a mismatch only shows up when a visitor switches theme.
 */

import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

export const EXPECTED_DIMENSIONS = {
  desktop: { width: 2880, height: 1800 },
  mobile: { width: 1170, height: 2532 },
};

const QUALITY = 82;

export function pairErrors(kind, names) {
  const scenes = new Map();
  for (const name of names) {
    const match = /^(.+)-(light|dark)$/.exec(name);
    if (!match) continue;
    const [, scene, theme] = match;
    scenes.set(scene, { ...(scenes.get(scene) ?? {}), [theme]: true });
  }
  const errors = [];
  for (const [scene, themes] of scenes) {
    if (!themes.light || !themes.dark) {
      errors.push(
        `${kind}/${scene}: incomplete pair (missing ${themes.light ? "dark" : "light"})`,
      );
    }
  }
  return errors;
}

export function dimensionError(kind, name, metadata) {
  const expected = EXPECTED_DIMENSIONS[kind];
  if (!expected) return `${kind}: unknown capture group`;
  if (
    metadata.width !== expected.width ||
    metadata.height !== expected.height
  ) {
    return `${kind}/${name}: expected ${expected.width}x${expected.height}, got ${metadata.width}x${metadata.height}`;
  }
  return undefined;
}

async function main() {
  const source = process.argv[2] ?? ".screenshots";
  const target = process.argv[3] ?? "src/assets/screenshots";
  const errors = [];
  const writes = [];

  for (const kind of Object.keys(EXPECTED_DIMENSIONS)) {
    const files = await readdir(join(source, kind)).catch(() => []);
    if (files.length === 0) continue;
    const pngs = files.filter((file) => file.endsWith(".png"));
    if (pngs.length === 0) continue;
    const names = pngs.map((file) => file.replace(/\.png$/, ""));
    errors.push(...pairErrors(kind, names));

    for (const name of names) {
      const input = join(source, kind, `${name}.png`);
      const image = sharp(input);
      const error = dimensionError(kind, name, await image.metadata());
      if (error) errors.push(error);
      else writes.push({ kind, name, input });
    }
  }

  if (errors.length > 0) {
    console.error("Screenshot optimization failed:");
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  for (const { kind, name, input } of writes) {
    const directory = join(target, kind);
    await mkdir(directory, { recursive: true });
    const output = join(directory, `${name}.webp`);
    await rm(output, { force: true });
    await sharp(input).webp({ quality: QUALITY, effort: 6 }).toFile(output);
    console.log(`wrote ${kind}/${name}.webp`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
