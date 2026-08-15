import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { eventEnvelopeSchema } from "@nervekit/contracts";
import { atomicWriteFile } from "../../storage/file-mutations.js";
import { pathExists } from "../../storage/json.js";
import type { StorageMigration } from "../migration.js";
import { migrationChecksum } from "../checksum.js";

const markerPath = "logs/.transient-conversation-live-events-v1";
const archiveRoot =
  "migrations/archives/0007-transient-conversation-live-events";

type StreamFiles = {
  conversationId: string;
  journal?: string;
  metadata?: string;
  lastSeq: number;
};

async function discover(home: string): Promise<StreamFiles[]> {
  const streams: StreamFiles[] = [];
  const root = join(home, "conversations");
  const conversations = await readdir(root, { withFileTypes: true }).catch(
    () => [],
  );
  for (const entry of conversations) {
    if (!entry.isDirectory() || !entry.name.startsWith("conv_")) continue;
    const relativeRoot = join("conversations", entry.name);
    const journal = join(relativeRoot, "events.jsonl");
    const metadata = join(relativeRoot, "events.meta.json");
    const hasJournal = await pathExists(join(home, journal));
    const hasMetadata = await pathExists(join(home, metadata));
    if (!hasJournal && !hasMetadata) continue;
    streams.push({
      conversationId: entry.name,
      journal: hasJournal ? journal : undefined,
      metadata: hasMetadata ? metadata : undefined,
      lastSeq: await readHighWater(
        home,
        hasJournal ? journal : undefined,
        hasMetadata ? metadata : undefined,
      ),
    });
  }
  return streams.sort((left, right) =>
    left.conversationId.localeCompare(right.conversationId),
  );
}

async function readHighWater(
  home: string,
  journal: string | undefined,
  metadata: string | undefined,
): Promise<number> {
  let lastSeq = 0;
  if (metadata) {
    const raw = JSON.parse(await readFile(join(home, metadata), "utf8")) as {
      lastSeq?: unknown;
    };
    if (!Number.isSafeInteger(raw.lastSeq) || Number(raw.lastSeq) < 0) {
      throw new Error(`Invalid event metadata: ${metadata}`);
    }
    lastSeq = Number(raw.lastSeq);
  }
  if (!journal) return lastSeq;
  const lines = (await readFile(join(home, journal), "utf8")).split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line?.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid event JSON at ${journal}:${index + 1}`, {
        cause: error,
      });
    }
    const parsed = eventEnvelopeSchema.safeParse(value);
    if (!parsed.success) {
      throw new Error(`Invalid event envelope at ${journal}:${index + 1}`);
    }
    lastSeq = Math.max(lastSeq, parsed.data.seq);
  }
  return lastSeq;
}

async function move(source: string, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await rename(source, target);
}

export const migration0007: StorageMigration = {
  id: "0007-transient-conversation-live-events",
  description: "Reset conversation streams for transient live notifications",
  checksum: migrationChecksum(
    "0007-transient-conversation-live-events|v1|Reset conversation streams for transient live notifications",
  ),
  async detect(context) {
    return (await pathExists(join(context.paths.home, markerPath)))
      ? "current"
      : "pending";
  },
  async backup(context) {
    const streams = await discover(context.paths.home);
    return {
      paths: [
        ...streams.flatMap((stream) =>
          [stream.journal, stream.metadata].filter(
            (path): path is string => path !== undefined,
          ),
        ),
        markerPath,
        archiveRoot,
      ],
    };
  },
  async up(context) {
    const home = context.paths.home;
    const streams = await discover(home);
    for (const stream of streams) {
      for (const relative of [stream.journal, stream.metadata]) {
        if (!relative) continue;
        await move(join(home, relative), join(home, archiveRoot, relative));
      }
      const metadata = join(
        home,
        "conversations",
        stream.conversationId,
        "events.meta.json",
      );
      await atomicWriteFile(
        metadata,
        `${JSON.stringify({ lastSeq: stream.lastSeq + 1 })}\n`,
        { mode: 0o600 },
      );
    }
    const marker = join(home, markerPath);
    await mkdir(dirname(marker), { recursive: true, mode: 0o755 });
    await writeFile(
      marker,
      `${JSON.stringify({ migratedAt: context.now().toISOString() })}\n`,
      { mode: 0o600, flag: "wx" },
    );
  },
  async verify(context) {
    if (!(await pathExists(join(context.paths.home, markerPath)))) {
      throw new Error("Transient conversation event marker is missing.");
    }
  },
};
