import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpTool } from "@nervekit/tools/quick-script";

/**
 * Each server's `tools/list` result, kept in memory and in `<cacheDirectory>/<sha256(key)>.json`
 * so a search can answer without starting the server, even after a restart. The key is the
 * resolved entry's digest: a changed entry gets a fresh index. A missing, unreadable or corrupt
 * file is a miss.
 */
export class McpToolIndex {
  private readonly cacheDirectory: string;
  private readonly memory = new Map<string, McpTool[]>();

  constructor(options: { cacheDirectory: string }) {
    this.cacheDirectory = options.cacheDirectory;
  }

  async get(key: string): Promise<McpTool[] | undefined> {
    const cached = this.memory.get(key);
    if (cached) return cached;
    try {
      const parsed: unknown = JSON.parse(
        await readFile(this.file(key), "utf8"),
      );
      if (!Array.isArray(parsed)) return undefined;
      const tools = parsed as McpTool[];
      this.memory.set(key, tools);
      return tools;
    } catch {
      return undefined;
    }
  }

  async set(key: string, tools: McpTool[]): Promise<void> {
    this.memory.set(key, tools);
    await mkdir(this.cacheDirectory, { recursive: true });
    const target = this.file(key);
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(tools));
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    this.memory.delete(key);
    await rm(this.file(key), { force: true });
  }

  private file(key: string): string {
    return join(
      this.cacheDirectory,
      `${createHash("sha256").update(key).digest("hex")}.json`,
    );
  }
}
