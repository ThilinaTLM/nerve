import { mkdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import sharp from "sharp";

const source = process.argv[2] ?? "/tmp/nerve-shots";
const output = resolve("packages/website/src/assets/shots");
const shots = [
  "d1-conversation",
  "d3-pull-request",
  "d4-tasks",
  "d5-git",
  "d6-history",
  "m1-conversation",
  "m2-model-picker",
  "m3-right-sheet",
];

await mkdir(output, { recursive: true });
for (const name of shots) {
  const desktop = name.startsWith("d");
  const target = resolve(output, `${name}.webp`);
  const result = await sharp(resolve(source, `${name}.png`))
    .resize({ width: desktop ? 2000 : 900, withoutEnlargement: true })
    .webp({ quality: 82, effort: 5 })
    .toFile(target);
  console.log(
    `${basename(target)} ${result.width}x${result.height} ${result.size} bytes`,
  );
}
