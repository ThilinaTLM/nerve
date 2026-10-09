import {
  chmod,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
} from "node:fs/promises";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { DatabaseSync } from "node:sqlite";
import { daemonFileSchema } from "../../packages/contracts/src/domains/status/status.js";
import { acquireStorageHomeLock } from "../../packages/workbench-server/src/infrastructure/storage-bootstrap/home-lock.js";
import { inspectNerveHome } from "../../packages/workbench-server/src/infrastructure/storage-bootstrap/state-layout.js";

export async function cloneNerveHome(input: {
  source: string;
  destination: string;
}): Promise<void> {
  const source = await realpath(resolve(input.source));
  if (!(await lstat(source)).isDirectory())
    throw new Error("Source home must be a directory");
  const requestedDestination = resolve(input.destination);
  const liveHome = await realpath(join(homedir(), ".nerve")).catch(() =>
    join(homedir(), ".nerve"),
  );
  const parent = await canonicalPath(dirname(requestedDestination));
  const destination = join(parent, basename(requestedDestination));
  if (within(source, destination) || within(destination, source))
    throw new Error(
      "Source and destination homes must not contain one another",
    );
  if (within(liveHome, destination) || within(destination, liveHome))
    throw new Error(
      "Clone destination must not contain or be inside the real Nerve home",
    );
  await assertAbsent(destination);
  const sourceLock = await acquireStorageHomeLock(source, { timeoutMs: 0 });
  let destinationLock:
    | Awaited<ReturnType<typeof acquireStorageHomeLock>>
    | undefined;
  let created = false;
  try {
    const daemon = await readFile(join(source, "daemon.json"), "utf8").catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      },
    );
    if (daemon !== null) daemonFileSchema.parse(JSON.parse(daemon));
    const inspection = await inspectNerveHome(source);
    if (inspection.kind !== "current")
      throw new Error(
        inspection.kind === "unsupported"
          ? inspection.reason
          : "Source is not an initialized Nerve home",
      );
    await mkdir(parent, { recursive: true, mode: 0o700 });
    await assertAbsent(destination);
    destinationLock = await acquireStorageHomeLock(destination, {
      timeoutMs: 0,
    });
    await mkdir(destination, { mode: 0o700 });
    created = true;
    // Copy active layout and managed assets, not stale daemon ownership, caches,
    // backups, or discarded migration work. Never checkpoint the source database.
    const included = new Set([
      "manifest.json",
      "config",
      "secrets",
      "data",
      "agent",
      "tls",
    ]);
    for (const entry of await readdir(source)) {
      if (!included.has(entry)) continue;
      await cp(join(source, entry), join(destination, entry), {
        recursive: true,
        errorOnExist: true,
        force: false,
        async filter(path) {
          const entry = await lstat(path);
          if (
            entry.isSymbolicLink() ||
            (!entry.isDirectory() && !entry.isFile())
          )
            throw new Error(
              `Cannot safely clone linked or special storage content: ${path}`,
            );
          return true;
        },
      });
    }
    await chmod(destination, 0o700);
    // A current home may not have opened the core yet. Its daemon initializes it.
    const sqlite = join(destination, "data", "core.sqlite");
    const databaseEntry = await lstat(sqlite).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      },
    );
    if (databaseEntry) {
      if (!databaseEntry.isFile())
        throw new Error("Copied core database is not a regular file");
      const database = new DatabaseSync(sqlite, { readOnly: true });
      try {
        if (database.prepare("PRAGMA quick_check").get()?.quick_check !== "ok")
          throw new Error("Copied core database failed quick_check");
      } finally {
        database.close();
      }
    }
  } catch (error) {
    if (created) await rm(destination, { recursive: true, force: true });
    throw error;
  } finally {
    await destinationLock?.release();
    await sourceLock.release();
  }
}

async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return join(await canonicalPath(dirname(path)), basename(path));
  }
}
function within(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return (
    path === "" ||
    (path !== ".." &&
      !path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
      !isAbsolute(path))
  );
}
async function assertAbsent(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error(`Clone destination already exists: ${path}`);
}
export function parseOptions(args: string[]): Map<string, string | true> {
  const result = new Map<string, string | true>();
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i],
      value = args[i + 1];
    if (!name?.startsWith("--") || !value || value.startsWith("--"))
      throw new Error(`Expected --option value, got ${name}`);
    if (result.has(name)) throw new Error(`Duplicate option ${name}`);
    result.set(name, value);
  }
  return result;
}
export function assertAllowedOptions(
  values: Map<string, string | true>,
  allowed: readonly string[],
): void {
  for (const name of values.keys())
    if (!allowed.includes(name)) throw new Error(`Unknown option ${name}`);
}
export function option(
  values: Map<string, string | true>,
  name: string,
  fallback?: string,
): string {
  const value = values.get(name) ?? fallback;
  if (typeof value !== "string" || !value)
    throw new Error(`Missing required option ${name}`);
  return value;
}
export function defaultNerveHome(): string {
  return process.env.NERVE_HOME?.trim() || join(homedir(), ".nerve");
}
