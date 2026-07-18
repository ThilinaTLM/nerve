import { mkdir, readdir, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { pathExists } from "../storage/index.js";

const DENSE_STREAM_MARKER = ".dense-streams-v1";

export interface LegacyEventIndex {
  dropLegacyEventIndex(): void;
}

/** Archives sparse/global journals once, then starts the dense stream epoch. */
export async function migrateLegacyEventLogs(
  home: string,
  index?: LegacyEventIndex,
): Promise<string | undefined> {
  const logsDir = join(home, "logs");
  const marker = join(logsDir, DENSE_STREAM_MARKER);
  if (await pathExists(marker)) return undefined;

  const archive = join(
    logsDir,
    "archive",
    `pre-dense-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`,
  );
  let archived = false;

  const logNames = await readdir(logsDir).catch(() => []);
  for (const name of logNames) {
    if (
      name === "events.jsonl" ||
      name.startsWith("events.jsonl.") ||
      name === "workspace-events.jsonl" ||
      name === "workspace-events.meta.json"
    ) {
      await move(join(logsDir, name), join(archive, "logs", name));
      archived = true;
    }
  }

  const conversationsDir = join(home, "conversations");
  const conversations = await readdir(conversationsDir, {
    withFileTypes: true,
  }).catch(() => []);
  for (const conversation of conversations) {
    if (!conversation.isDirectory()) continue;
    for (const name of ["events.jsonl", "events.meta.json"]) {
      const source = join(conversationsDir, conversation.name, name);
      if (!(await pathExists(source))) continue;
      await move(
        source,
        join(archive, "conversations", conversation.name, basename(source)),
      );
      archived = true;
    }
  }

  index?.dropLegacyEventIndex();
  await mkdir(logsDir, { recursive: true });
  await writeFile(
    marker,
    `${JSON.stringify({ migratedAt: new Date().toISOString() })}\n`,
    {
      mode: 0o600,
    },
  );
  return archived ? archive : undefined;
}

async function move(source: string, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  await rename(source, target);
}
