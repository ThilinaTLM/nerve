import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
export type StoredSandboxEvent = {
  sandboxId: string;
  seq?: number;
  id?: string;
  type: string;
  ts?: string;
  payload: unknown;
};
export class EventStore {
  constructor(private readonly rootDir: string) {}
  async append(event: StoredSandboxEvent): Promise<boolean> {
    await mkdir(this.rootDir, { recursive: true });
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
  }
  async list(sandboxId: string): Promise<StoredSandboxEvent[]> {
    try {
      const raw = await readFile(
        path.join(this.rootDir, `${sandboxId}.json`),
        "utf8",
      );
      return JSON.parse(raw) as StoredSandboxEvent[];
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: unknown }).code === "ENOENT"
      )
        return [];
      throw error;
    }
  }
}
async function writeJson(file: string, value: unknown): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmp, file);
}
