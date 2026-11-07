import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { repoRoot } from "../workspace/repo.ts";

export async function expectedNativePrebuilds(rootDirectory = repoRoot) {
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

export function nativePrebuildFilename(target: string) {
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
  directory: string,
  rootDirectory = repoRoot,
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

export interface NativePlatformPackage {
  /** napi platform triple, e.g. `linux-x64-gnu`. */
  triple: string;
  /** Published npm name, e.g. `@nervekit/native-linux-x64-gnu`. */
  name: string;
  /** Binary filename inside the package, e.g. `nerve_native.linux-x64-gnu.node`. */
  filename: string;
  os: string;
  cpu: string;
  libc?: string[];
}

/** Parses `nerve_native.<triple>.node` into per-platform npm package metadata. */
export function nativePlatformPackage(filename: string): NativePlatformPackage {
  const match =
    /^nerve_native\.((linux|win32|darwin)-(x64|arm64)(?:-(gnu|msvc))?)\.node$/.exec(
      filename,
    );
  if (!match) throw new Error(`Unrecognized native prebuild ${filename}.`);
  const [, triple, os, cpu] = match;
  return {
    triple,
    name: `@nervekit/native-${triple}`,
    filename,
    os,
    cpu,
    ...(os === "linux" ? { libc: ["glibc"] } : {}),
  };
}

export async function expectedNativePlatformPackages(
  rootDirectory = repoRoot,
): Promise<NativePlatformPackage[]> {
  return (await expectedNativePrebuilds(rootDirectory))
    .map(nativePlatformPackage)
    .sort((left, right) => left.triple.localeCompare(right.triple));
}

export function nativeTarballFilename(
  platformPackage: NativePlatformPackage,
  version: string,
) {
  return `nervekit-native-${platformPackage.triple}-${version}.tgz`;
}
