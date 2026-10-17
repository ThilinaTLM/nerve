import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, open, readdir, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertSlotPaths,
  resolveStorageSlot,
} from "../development/storage-slot.mjs";
import { acquireStorageHomeLock } from "../../packages/workbench-server/src/infrastructure/storage-bootstrap/home-lock.js";

/** Bounded reads even for multi-gigabyte SQLite files. */
export async function hashRehearsalFile(
  path: string,
  chunkBytes = 64 * 1024,
): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path, {
    highWaterMark: chunkBytes,
  }))
    hash.update(chunk);
  return hash.digest("hex");
}
async function* files(directory: string): AsyncGenerator<string> {
  const entry = await lstat(directory);
  if (!entry.isDirectory() || entry.isSymbolicLink())
    throw new Error(`Unsafe baseline directory ${directory}`);
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else if (entry.isFile()) yield path;
    else throw new Error(`Refusing linked or special baseline input ${path}`);
  }
}
/** Stream both file bytes and checksum lines; publish only a complete baseline. */
export async function writeRehearsalBaseline(
  home: string,
  projects: string,
  output: string,
): Promise<void> {
  const temporary = `${output}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    for (const root of [home, projects]) {
      for await (const path of files(root)) {
        const absolute = resolve(path);
        if (/[\n\r\\]/.test(absolute))
          throw new Error("Unsupported checksum path");
        await handle.writeFile(
          `${await hashRehearsalFile(path)}  ${absolute}\n`,
        );
      }
    }
    await handle.sync();
    await handle.close();
    await rename(temporary, output);
  } finally {
    await handle.close();
    await rm(temporary, { force: true });
  }
}

// Checksum-only recovery after a failed rehearsal; never clone or reinject damage.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const args = process.argv.slice(2).filter((arg) => arg !== "--");
    if (args.length !== 2 || args[0] !== "--slot")
      throw new Error("Expected --slot N");
    const slot = resolveStorageSlot(args);
    if (slot.slot === 1) throw new Error("Rehearsal refuses slot 1");
    await assertSlotPaths(slot);
    const lock = await acquireStorageHomeLock(slot.home, { timeoutMs: 0 });
    try {
      const output = join(slot.data, `storage-${slot.slot}-baseline.sha`);
      await writeRehearsalBaseline(
        slot.home,
        join(slot.data, `storage-${slot.slot}-projects`),
        output,
      );
      console.log(
        `Baseline complete: ${output}\nVerify after restore (with daemon stopped): sha256sum -c '${output}'`,
      );
    } finally {
      await lock.release();
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
