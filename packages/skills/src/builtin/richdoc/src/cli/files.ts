import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export interface Manifest {
  version: string;
  files: Record<string, { sha256: string; bytes: number }>;
}
export const hash = (content: Uint8Array | string) =>
  createHash("sha256").update(content).digest("hex");
export function contained(root: string, path: string) {
  const child = relative(root, path);
  return (
    child === "" ||
    (!isAbsolute(child) && child !== ".." && !child.startsWith(`..${sep}`))
  );
}
export async function noSymlinks(path: string) {
  let current = resolve(path);
  while (true) {
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink())
        throw new Error(`Symlink paths are not supported: ${current}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}
export async function exists(path: string) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
export async function atomicWrite(path: string, data: Uint8Array | string) {
  await noSymlinks(path);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    await writeFile(temporary, data, { flag: "wx" });
    await noSymlinks(path);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
export async function readManifest(root: string): Promise<Manifest> {
  return JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
}
export const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
