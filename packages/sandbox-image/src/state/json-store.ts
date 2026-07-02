import { mkdir, open, readFile, rename } from "node:fs/promises";
import path from "node:path";

export async function atomicWriteFile(
  filePath: string,
  data: string | Buffer,
  mode?: number,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  const handle = await open(tmp, "w", mode);
  try {
    await handle.writeFile(data);
    await handle.sync().catch(() => undefined);
  } finally {
    await handle.close();
  }
  await rename(tmp, filePath);
}

export class JsonStore<T> {
  constructor(
    private readonly filePath: string,
    private readonly schema?: { parse(value: unknown): T },
  ) {}

  async read(defaultValue: T): Promise<T> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      return this.schema ? this.schema.parse(parsed) : (parsed as T);
    } catch (error) {
      if (isNotFound(error)) return defaultValue;
      throw error;
    }
  }

  async write(value: T, mode?: number): Promise<void> {
    const parsed = this.schema ? this.schema.parse(value) : value;
    await atomicWriteFile(
      this.filePath,
      `${JSON.stringify(parsed, null, 2)}\n`,
      mode,
    );
  }
}

export function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
