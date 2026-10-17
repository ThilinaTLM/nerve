import { basename, join, resolve } from "node:path";
import {
  repositoryRoot,
  resolveStorageSlot,
} from "../development/storage-slot.mjs";
export const presets = [
  "config",
  "overlay",
  "conversation",
  "message",
  "runtime-json",
  "runtime-shape",
] as const;
export function rehearseOptions(args: string[], repo = repositoryRoot) {
  const values = new Map<string, string | true>();
  args = args.filter((arg) => arg !== "--");
  for (let i = 0; i < args.length; i++) {
    const key = args[i]!;
    if (
      !["--from", "--slot", "--corrupt", "--keep", "--force-reset"].includes(
        key,
      ) ||
      values.has(key)
    )
      throw new Error(`Unknown or duplicate option ${key}`);
    if (["--keep", "--force-reset"].includes(key)) values.set(key, true);
    else {
      const value = args[++i];
      if (!value || value.startsWith("--"))
        throw new Error(`Missing value for ${key}`);
      values.set(key, value);
    }
  }
  if (!values.has("--from") || !values.has("--slot"))
    throw new Error("Expected --from HOME --slot N");
  const slot = resolveStorageSlot(
    ["--slot", String(values.get("--slot"))],
    repo,
  );
  if (slot.slot === 1) throw new Error("Rehearsal refuses slot 1");
  const corrupt = values.get("--corrupt") as string | undefined;
  if (corrupt && !presets.includes(corrupt as (typeof presets)[number]))
    throw new Error(`Unknown corruption preset ${corrupt}`);
  return {
    source: resolve(String(values.get("--from"))),
    slot,
    corrupt,
    keep: values.has("--keep"),
    forceReset: values.has("--force-reset"),
  };
}
export function redirectProject(
  document: Record<string, unknown>,
  root: string,
) {
  const source = document.dir ?? document.directory;
  if (typeof source !== "string" || !source)
    throw new Error("Project has no directory");
  const destination = join(root, basename(resolve(source)));
  return {
    source,
    destination,
    document: {
      ...document,
      ...("dir" in document ? { dir: destination } : {}),
      ...("directory" in document ? { directory: destination } : {}),
    },
  };
}
