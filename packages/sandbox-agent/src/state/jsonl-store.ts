import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export class JsonlStore<T> {
  constructor(
    private readonly filePath: string,
    private readonly schema?: { parse(value: unknown): T },
  ) {}

  async append(record: T): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const parsed = this.schema ? this.schema.parse(record) : record;
    const handle = await open(this.filePath, "a");
    try {
      await handle.write(`${JSON.stringify(parsed)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async replace(records: readonly T[]): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const parsed = records.map((record) =>
      this.schema ? this.schema.parse(record) : record,
    );
    const temporary = `${this.filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await writeFile(
      temporary,
      parsed.length > 0
        ? `${parsed.map((record) => JSON.stringify(record)).join("\n")}\n`
        : "",
      { mode: 0o600 },
    );
    await rename(temporary, this.filePath);
  }

  async readAll(): Promise<T[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
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
    const records: T[] = [];
    for (const [index, line] of raw.split(/\r?\n/).entries()) {
      if (!line.trim()) continue;
      try {
        const value = JSON.parse(line) as unknown;
        records.push(this.schema ? this.schema.parse(value) : (value as T));
      } catch (error) {
        throw new Error(
          `Invalid JSONL record ${index + 1} in ${this.filePath}: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
    }
    return records;
  }
}
