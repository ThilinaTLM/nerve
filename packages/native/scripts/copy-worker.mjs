import { chmod, copyFile, mkdir, rename } from "node:fs/promises";
import { join, resolve } from "node:path";

const target = process.argv[2];
const profile = process.argv.includes("--debug") ? "debug" : "release";
const root = resolve(import.meta.dirname, "..", "..", "..");
const platform = target ? platformForTarget(target) : hostPlatform();
const source = join(
  root,
  "target",
  ...(target ? [target] : []),
  profile,
  `nerve_execution_worker${platform.startsWith("win32-") ? ".exe" : ""}`,
);
const outputDir = join(
  root,
  "packages",
  "native",
  "prebuilds",
  ...(process.argv.includes("--release-dir") ? [] : ["local"]),
);
const destination = join(
  outputDir,
  `nerve_execution_worker.${platform}${platform.startsWith("win32-") ? ".exe" : ""}`,
);
await mkdir(outputDir, { recursive: true });
const temporary = `${destination}.${process.pid}.tmp`;
await copyFile(source, temporary);
if (!platform.startsWith("win32-")) await chmod(temporary, 0o755);
await rename(temporary, destination);
console.log(`Copied execution worker to ${destination}`);

function hostPlatform() {
  const arch = process.arch === "x64" ? "x64" : "arm64";
  if (process.platform === "linux") return `linux-${arch}-gnu`;
  if (process.platform === "win32") return `win32-${arch}-msvc`;
  if (process.platform === "darwin") return `darwin-${arch}`;
  throw new Error(`Unsupported host ${process.platform}/${process.arch}`);
}

function platformForTarget(value) {
  const match =
    /^(x86_64|aarch64)-(unknown-linux-gnu|pc-windows-msvc|apple-darwin)$/.exec(
      value,
    );
  if (!match) throw new Error(`Unsupported worker target ${value}`);
  const arch = match[1] === "x86_64" ? "x64" : "arm64";
  return {
    "unknown-linux-gnu": `linux-${arch}-gnu`,
    "pc-windows-msvc": `win32-${arch}-msvc`,
    "apple-darwin": `darwin-${arch}`,
  }[match[2]];
}
