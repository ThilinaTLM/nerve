import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultRepoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

export async function expectedNativePrebuilds(rootDirectory = defaultRepoRoot) {
  const manifest = JSON.parse(
    await readFile(
      join(rootDirectory, "packages", "native", "package.json"),
      "utf8",
    ),
  );
  const targets = manifest.napi?.targets;
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error("packages/native/package.json must declare napi.targets.");
  }
  const filenames = targets.map(nativePrebuildFilename);
  if (new Set(filenames).size !== filenames.length) {
    throw new Error("Native targets map to duplicate prebuild filenames.");
  }
  return filenames;
}

export function nativePrebuildFilename(target) {
  const match =
    /^(x86_64|aarch64)-(unknown-linux-gnu|pc-windows-msvc|apple-darwin)$/.exec(
      target,
    );
  if (!match) throw new Error(`Unsupported native release target ${target}.`);
  const architecture = match[1] === "x86_64" ? "x64" : "arm64";
  const platform = {
    "unknown-linux-gnu": `linux-${architecture}-gnu`,
    "pc-windows-msvc": `win32-${architecture}-msvc`,
    "apple-darwin": `darwin-${architecture}`,
  }[match[2]];
  return `nerve_native.${platform}.node`;
}

export async function verifyNativePrebuilds(
  directory,
  rootDirectory = defaultRepoRoot,
) {
  const expected = (await expectedNativePrebuilds(rootDirectory)).sort();
  const entries = await readdir(directory, { withFileTypes: true });
  const actual = entries.map((entry) => entry.name).sort();
  const nonFiles = entries.filter((entry) => !entry.isFile());
  if (
    nonFiles.length > 0 ||
    JSON.stringify(actual) !== JSON.stringify(expected)
  ) {
    throw new Error(
      `Native prebuild inventory in ${directory} must contain exactly:\n${expected
        .map((name) => `  ${name}`)
        .join(
          "\n",
        )}\nFound:\n${actual.map((name) => `  ${name}`).join("\n") || "  (empty)"}`,
    );
  }
  return expected;
}
