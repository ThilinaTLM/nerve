import { mkdir, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const maxBytes = 256 * 1024;
const maxEntries = 1000;
const halfLifeMs = 30 * 24 * 60 * 60 * 1000;
type UsageEntry = {
  projectId: string;
  id: string;
  count: number;
  lastUsed: number;
};

/** Explicit configured home only; never falls back to the user's real home. */
export class CompletionUsageStore {
  private entries: UsageEntry[] = [];
  private loaded?: Promise<void>;
  private tail = Promise.resolve();
  private readonly path: string;

  constructor(
    private readonly home: string,
    private readonly now = Date.now,
  ) {
    this.path = join(home, "cache", "completion-usage.json");
  }

  async scores(projectId: string): Promise<ReadonlyMap<string, number>> {
    await this.load();
    return new Map(
      this.entries
        .filter((entry) => entry.projectId === projectId)
        .map((entry) => [entry.id, this.decayed(entry)]),
    );
  }

  record(projectId: string, id: string): Promise<void> {
    // IDs are opaque, never paths to open. Bound both individual strings and
    // total encoded bytes (Unicode escaping can exceed JS string length).
    if (!projectId || !id || projectId.length > 256 || id.length > 2048)
      return Promise.resolve();
    const task = this.tail.then(async () => {
      await this.load();
      const previous = this.entries.find(
        (entry) => entry.projectId === projectId && entry.id === id,
      );
      const next = {
        projectId,
        id,
        count: Math.min(100, (previous ? this.decayed(previous) : 0) + 1),
        lastUsed: this.now(),
      };
      this.entries = [
        next,
        ...this.entries.filter(
          (entry) => entry !== previous && this.decayed(entry) >= 0.01,
        ),
      ]
        .sort((a, b) => b.lastUsed - a.lastUsed || a.id.localeCompare(b.id))
        .slice(0, maxEntries);
      let json = JSON.stringify({ version: 1, entries: this.entries });
      while (Buffer.byteLength(json) > maxBytes) {
        this.entries.pop();
        json = JSON.stringify({ version: 1, entries: this.entries });
      }
      const directory = join(this.home, "cache");
      await mkdir(directory, { recursive: true });
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      try {
        const file = await open(temporary, "wx", 0o600);
        try {
          await file.writeFile(json);
        } finally {
          await file.close();
        }
        await rename(temporary, this.path);
      } finally {
        await rm(temporary, { force: true });
      }
    });
    // Usage is optional: a read-only/unavailable home must not break selection.
    this.tail = task.catch(() => undefined);
    return this.tail;
  }

  private decayed(entry: UsageEntry): number {
    return (
      entry.count *
      2 ** (-Math.max(0, this.now() - entry.lastUsed) / halfLifeMs)
    );
  }

  private load(): Promise<void> {
    return (this.loaded ??= (async () => {
      try {
        const file = await open(this.path, "r");
        let raw: string;
        try {
          if ((await file.stat()).size > maxBytes) return;
          // Bound reading even if another process replaces/grows the file.
          const buffer = Buffer.alloc(maxBytes + 1);
          const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
          if (bytesRead > maxBytes) return;
          raw = buffer.subarray(0, bytesRead).toString("utf8");
        } finally {
          await file.close();
        }
        const data: unknown = JSON.parse(raw);
        if (
          !data ||
          typeof data !== "object" ||
          !("version" in data) ||
          data.version !== 1 ||
          !("entries" in data) ||
          !Array.isArray(data.entries)
        )
          return;
        const seen = new Set<string>();
        this.entries = data.entries
          .slice(0, maxEntries)
          .filter((entry): entry is UsageEntry => {
            if (
              !entry ||
              typeof entry !== "object" ||
              typeof entry.projectId !== "string" ||
              !entry.projectId ||
              entry.projectId.length > 256 ||
              typeof entry.id !== "string" ||
              !entry.id ||
              entry.id.length > 2048 ||
              !Number.isFinite(entry.count) ||
              entry.count <= 0 ||
              entry.count > 100 ||
              !Number.isFinite(entry.lastUsed) ||
              entry.lastUsed < 0 ||
              entry.lastUsed > this.now()
            )
              return false;
            const key = JSON.stringify([entry.projectId, entry.id]);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
      } catch {
        /* Missing, corrupt, or inaccessible history is neutral. */
      }
    })());
  }
}
