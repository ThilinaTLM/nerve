import {
  launchLogEventSchema,
  type LaunchLogEvent,
} from "@nervekit/contracts/launches";
import {
  access,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { retryRename } from "../../../infrastructure/storage-bootstrap/file-mutations.js";
import { randomUUID } from "node:crypto";

const REMOVE_RETRY = { maxRetries: 5, retryDelay: 50 };

export type LaunchLogBundlePaths = {
  dir: string;
  eventsPath: string;
  stdoutPath: string;
  stderrPath: string;
  combinedPath: string;
};

export class LaunchLogBundleStore {
  constructor(private readonly root: string) {}

  paths(launchId: string): LaunchLogBundlePaths {
    assertLaunchId(launchId);
    const dir = join(this.root, launchId);
    return {
      dir,
      eventsPath: join(dir, "events.jsonl"),
      stdoutPath: join(dir, "stdout.txt"),
      stderrPath: join(dir, "stderr.txt"),
      combinedPath: join(dir, "combined.txt"),
    };
  }

  async initializeLaunch(launchId: string): Promise<LaunchLogBundlePaths> {
    const paths = this.paths(launchId);
    await mkdir(paths.dir, { recursive: true, mode: 0o700 });
    return paths;
  }

  async migrateLegacy(launchId: string): Promise<void> {
    const paths = this.paths(launchId);
    const legacy = join(this.root, `${launchId}.logs.jsonl`);
    const raw = await readFile(legacy, "utf8").catch(() => undefined);
    if (raw === undefined) {
      await this.initializeLaunch(launchId);
      return;
    }
    const staging = join(this.root, `.${launchId}.staging-${randomUUID()}`);
    await mkdir(staging, { recursive: true, mode: 0o700 });
    const streams = { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    const events: LaunchLogEvent[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const event = launchLogEventSchema.safeParse(parsed);
      if (!event.success) continue;
      const stream = event.data.stream;
      const bytes = Buffer.from(`${event.data.line}\n`, "utf8");
      const start = streams[stream].byteLength;
      streams[stream] = Buffer.concat([streams[stream], bytes]);
      events.push({
        ...event.data,
        raw: {
          start,
          end: start + bytes.byteLength,
          terminatorBytes: 1,
          fidelity: "reconstructed",
        },
      });
    }
    await Promise.all([
      writeFile(join(staging, "stdout.txt"), streams.stdout, { mode: 0o600 }),
      writeFile(join(staging, "stderr.txt"), streams.stderr, { mode: 0o600 }),
      writeFile(
        join(staging, "events.jsonl"),
        events.map((event) => JSON.stringify(event)).join("\n") +
          (events.length ? "\n" : ""),
        { mode: 0o600 },
      ),
    ]);
    await rm(paths.dir, { recursive: true, force: true, ...REMOVE_RETRY });
    await mkdir(dirname(paths.dir), { recursive: true, mode: 0o700 });
    await retryRename(staging, paths.dir);
    await rm(legacy, { force: true });
  }

  async reconcile(validLaunchIds: ReadonlySet<string>): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const entries = await readdir(this.root, { withFileTypes: true });
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const transient = /^\.(launch_[A-Za-z0-9_-]+)\.(staging|tombstone)-/.exec(
        entry.name,
      );
      if (transient && entry.isDirectory()) {
        const [, launchId] = transient;
        const candidate = join(this.root, entry.name);
        const target = this.paths(launchId).dir;
        const targetExists = await access(target)
          .then(() => true)
          .catch(() => false);
        if (validLaunchIds.has(launchId) && !targetExists) {
          await retryRename(candidate, target).catch(async () => {
            await rm(candidate, {
              recursive: true,
              force: true,
              ...REMOVE_RETRY,
            });
          });
        } else {
          await rm(candidate, {
            recursive: true,
            force: true,
            ...REMOVE_RETRY,
          });
        }
        continue;
      }
      if (
        entry.isDirectory() &&
        /^launch_[A-Za-z0-9_-]+$/.test(entry.name) &&
        !validLaunchIds.has(entry.name)
      ) {
        await rm(join(this.root, entry.name), {
          recursive: true,
          force: true,
          ...REMOVE_RETRY,
        });
      }
    }
  }

  async remove(launchId: string): Promise<void> {
    const paths = this.paths(launchId);
    const tombstone = join(this.root, `.${launchId}.tombstone-${randomUUID()}`);
    let renamed = false;
    try {
      await retryRename(paths.dir, tombstone);
      renamed = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (renamed)
      await rm(tombstone, { recursive: true, force: true, ...REMOVE_RETRY });
    await rm(join(this.root, `${launchId}.logs.jsonl`), { force: true });
  }
}

function assertLaunchId(launchId: string): void {
  if (!/^launch_[A-Za-z0-9_-]+$/.test(launchId))
    throw new Error("Invalid launch ID.");
}
