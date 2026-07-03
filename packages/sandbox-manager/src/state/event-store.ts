import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile, isNotFound } from "./atomic-write.js";
export type StoredSandboxEvent = {
  sandboxId: string;
  seq?: number;
  id?: string;
  type: string;
  ts?: string;
  durability?: "durable" | "transient";
  payload: unknown;
};
export class EventStore {
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(private readonly rootDir: string) {}
  async append(event: StoredSandboxEvent): Promise<boolean> {
    await mkdir(this.rootDir, { recursive: true });
    return this.withSandboxQueue(event.sandboxId, async () => {
      const existing = await this.list(event.sandboxId);
      if (
        existing.some(
          (item) =>
            (event.id && item.id === event.id) ||
            (event.seq !== undefined && item.seq === event.seq),
        )
      )
        return false;
      existing.push(event);
      await writeJson(
        path.join(this.rootDir, `${event.sandboxId}.json`),
        existing,
      );
      return true;
    });
  }
  async list(sandboxId: string): Promise<StoredSandboxEvent[]> {
    try {
      const raw = await readFile(
        path.join(this.rootDir, `${sandboxId}.json`),
        "utf8",
      );
      return JSON.parse(raw) as StoredSandboxEvent[];
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
  }

  private async withSandboxQueue<T>(
    sandboxId: string,
    run: () => Promise<T>,
  ): Promise<T> {
    const previous = this.queues.get(sandboxId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(run);
    const queued = next.catch(() => undefined).finally(() => {
      if (this.queues.get(sandboxId) === queued) this.queues.delete(sandboxId);
    });
    this.queues.set(sandboxId, queued);
    return next;
  }
}
async function writeJson(file: string, value: unknown): Promise<void> {
  await atomicWriteFile(file, `${JSON.stringify(value, null, 2)}\n`, 0o600);
}
