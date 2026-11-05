import { lstat, readFile, realpath, unlink } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { assertSlotPaths, type StorageSlot } from "./storage-slot.ts";

type DaemonFile =
  import("../../packages/contracts/src/domains/status/status.js").DaemonFile;

interface SlotDaemonRecord {
  daemon: DaemonFile;
  raw: string;
  foreign: boolean;
}

type Request = (url: URL, init: RequestInit) => Promise<{ ok: boolean }>;

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

async function readSlotDaemon(
  slot: StorageSlot,
): Promise<SlotDaemonRecord | undefined> {
  let raw: string;
  try {
    const path = join(slot.home, "daemon.json");
    const entry = await lstat(path);
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error(
        "Development daemon.json must be a regular, non-linked file.",
      );
    }
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
  const { nerveHomeManifestSchema } =
    await import("../../packages/contracts/src/domains/settings/home-configuration.js");
  nerveHomeManifestSchema.parse(
    JSON.parse(await readFile(join(slot.home, "manifest.json"), "utf8")),
  );
  const { daemonFileSchema } =
    await import("../../packages/contracts/src/domains/status/status.js");
  let daemon: DaemonFile;
  try {
    daemon = daemonFileSchema.parse(JSON.parse(raw));
  } catch (cause) {
    throw new Error(
      "Invalid development daemon.json; refusing to launch. Inspect it manually.",
      { cause },
    );
  }
  return { daemon, raw, foreign: resolve(daemon.dataDir) !== slot.home };
}

async function inspectDaemonRecord(
  slot: StorageSlot,
  record: SlotDaemonRecord | undefined,
  request: Request,
): Promise<boolean> {
  // Copied runtime metadata describes the source, not an owner of this home.
  // Never contact its URL, resolve its source path, or inspect/signal its PID.
  if (!record || record.foreign) return false;
  const { daemon } = record;
  // Crashed starts can leave incomplete metadata. A dead PID cannot own this
  // home; preflight still verifies both ports before allowing a new launch.
  try {
    process.kill(daemon.pid, 0);
  } catch (error) {
    if (errorCode(error) === "ESRCH") return false;
    throw new Error(
      "Cannot verify the development daemon owner; refusing to launch.",
      { cause: error },
    );
  }

  if (
    (await realpath(daemon.dataDir)) !== (await realpath(slot.home)) ||
    daemon.host !== "127.0.0.1" ||
    daemon.port !== slot.httpPort ||
    daemon.url !== `http://127.0.0.1:${slot.httpPort}` ||
    daemon.mobileHttps?.port !== slot.httpsPort
  ) {
    throw new Error(
      "Development daemon.json does not match this slot's home and ports. No process was stopped.",
    );
  }
  const token = (
    await readFile(join(slot.home, "secrets", "daemon-token"), "utf8")
  ).trim();
  if (!token)
    throw new Error("Development daemon token is empty; refusing to launch.");
  let healthy = false;
  try {
    const response = await request(new URL("/api/health", daemon.url), {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(1500),
    });
    healthy = response.ok;
  } catch {
    // A dead daemon may leave metadata. Ports and PID are checked before launch.
  }
  if (healthy) return true;
  try {
    process.kill(daemon.pid, 0);
  } catch (error) {
    if (errorCode(error) === "ESRCH") return false;
    throw new Error(
      "Cannot verify the development daemon owner; refusing to launch.",
      { cause: error },
    );
  }
  throw new Error(
    "Development daemon owner is alive but authentication/health failed; stop it through its owner before retrying.",
  );
}

export async function inspectSlotDaemon(
  slot: StorageSlot,
  request: Request = fetch,
): Promise<boolean> {
  await assertSlotPaths(slot);
  return inspectDaemonRecord(slot, await readSlotDaemon(slot), request);
}

export async function preflightSlot(
  slot: StorageSlot,
  {
    inspect,
    probe = assertPortFree,
  }: {
    inspect?: (slot: StorageSlot) => Promise<boolean>;
    probe?: (port: number) => Promise<void>;
  } = {},
): Promise<boolean> {
  await assertSlotPaths(slot);
  const record = await readSlotDaemon(slot);
  if (
    await (inspect ? inspect(slot) : inspectDaemonRecord(slot, record, fetch))
  )
    return true;
  await probe(slot.httpPort);
  await probe(slot.httpsPort);
  if (record?.foreign) {
    // Remove only the destination's copied runtime record, after verifying its
    // ports are free. Desktop discovery must not attach to the source daemon.
    await assertSlotPaths(slot);
    const current = await readSlotDaemon(slot);
    if (!current?.foreign || current.raw !== record.raw) {
      throw new Error(
        "Development daemon.json changed during preflight; retry the launch.",
      );
    }
    await unlink(join(slot.home, "daemon.json"));
  }
  return false;
}

export async function assertPortFree(port: number): Promise<void> {
  for (const host of ["0.0.0.0", "::"]) {
    await new Promise<void>((resolvePromise, reject) => {
      const server = createServer();
      server.once("error", (cause: Error) => {
        if (
          host === "::" &&
          ["EAFNOSUPPORT", "EADDRNOTAVAIL"].includes(errorCode(cause) ?? "")
        ) {
          resolvePromise();
          return;
        }
        reject(
          new Error(
            `Development port ${port} is unavailable (${errorCode(cause)}); refusing to reuse it or stop its owner.`,
            { cause },
          ),
        );
      });
      server.listen(
        { host, port, exclusive: true, ipv6Only: host === "::" },
        () => {
          server.close((error) => (error ? reject(error) : resolvePromise()));
        },
      );
    });
  }
}
