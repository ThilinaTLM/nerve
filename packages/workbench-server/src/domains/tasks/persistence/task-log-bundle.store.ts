import {
  taskLogEventSchema,
  type TaskLogEvent,
} from "@nervekit/contracts/tasks";
import {
  access,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export type TaskLogBundlePaths = {
  dir: string;
  eventsPath: string;
  stdoutPath: string;
  stderrPath: string;
  combinedPath: string;
};

export class TaskLogBundleStore {
  constructor(private readonly root: string) {}

  paths(taskId: string): TaskLogBundlePaths {
    assertTaskId(taskId);
    const dir = join(this.root, taskId);
    return {
      dir,
      eventsPath: join(dir, "events.jsonl"),
      stdoutPath: join(dir, "stdout.txt"),
      stderrPath: join(dir, "stderr.txt"),
      combinedPath: join(dir, "combined.txt"),
    };
  }

  async initializeTask(taskId: string): Promise<TaskLogBundlePaths> {
    const paths = this.paths(taskId);
    await mkdir(paths.dir, { recursive: true, mode: 0o700 });
    return paths;
  }

  async migrateLegacy(taskId: string): Promise<void> {
    const paths = this.paths(taskId);
    const legacy = join(this.root, `${taskId}.logs.jsonl`);
    const raw = await readFile(legacy, "utf8").catch(() => undefined);
    if (raw === undefined) {
      await this.initializeTask(taskId);
      return;
    }
    const staging = join(this.root, `.${taskId}.staging-${randomUUID()}`);
    await mkdir(staging, { recursive: true, mode: 0o700 });
    const streams = { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    const events: TaskLogEvent[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const event = taskLogEventSchema.safeParse(parsed);
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
    await rm(paths.dir, { recursive: true, force: true });
    await mkdir(dirname(paths.dir), { recursive: true, mode: 0o700 });
    await rename(staging, paths.dir);
    await rm(legacy, { force: true });
  }

  async reconcile(validTaskIds: ReadonlySet<string>): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const entries = await readdir(this.root, { withFileTypes: true });
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const transient = /^\.(task_[A-Za-z0-9_-]+)\.(staging|tombstone)-/.exec(
        entry.name,
      );
      if (transient && entry.isDirectory()) {
        const [, taskId] = transient;
        const candidate = join(this.root, entry.name);
        const target = this.paths(taskId!).dir;
        const targetExists = await access(target)
          .then(() => true)
          .catch(() => false);
        if (validTaskIds.has(taskId!) && !targetExists) {
          await rename(candidate, target).catch(async () => {
            await rm(candidate, { recursive: true, force: true });
          });
        } else {
          await rm(candidate, { recursive: true, force: true });
        }
        continue;
      }
      if (
        entry.isDirectory() &&
        /^task_[A-Za-z0-9_-]+$/.test(entry.name) &&
        !validTaskIds.has(entry.name)
      ) {
        await rm(join(this.root, entry.name), { recursive: true, force: true });
      }
    }
  }

  async remove(taskId: string): Promise<void> {
    const paths = this.paths(taskId);
    const tombstone = join(this.root, `.${taskId}.tombstone-${randomUUID()}`);
    let renamed = false;
    try {
      await rename(paths.dir, tombstone);
      renamed = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (renamed) await rm(tombstone, { recursive: true, force: true });
    await rm(join(this.root, `${taskId}.logs.jsonl`), { force: true });
  }
}

function assertTaskId(taskId: string): void {
  if (!/^task_[A-Za-z0-9_-]+$/.test(taskId))
    throw new Error("Invalid task ID.");
}
