import { mkdir, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathExists } from "../../storage/json.js";
import type { StorageMigration } from "../migration.js";
import { joinCanonicalPath } from "../canonical-path.js";
import { migrationChecksum } from "../checksum.js";

const markerPath = "logs/.dense-streams-v1";
const archiveRoot = "migrations/archives/0004-dense-event-stream-layout";

async function legacyPaths(home: string): Promise<string[]> {
  const paths: string[] = [];
  for (const name of await readdir(join(home, "logs")).catch(() => [])) {
    if (
      name === "events.jsonl" ||
      name.startsWith("events.jsonl.") ||
      name === "workspace-events.jsonl" ||
      name === "workspace-events.meta.json"
    )
      paths.push(joinCanonicalPath("logs", name));
  }
  const conversations = await readdir(join(home, "conversations"), {
    withFileTypes: true,
  }).catch(() => []);
  for (const conversation of conversations) {
    if (!conversation.isDirectory()) continue;
    for (const name of ["events.jsonl", "events.meta.json"]) {
      const relative = joinCanonicalPath(
        "conversations",
        conversation.name,
        name,
      );
      if (await pathExists(join(home, relative))) paths.push(relative);
    }
  }
  return paths.sort();
}

async function move(source: string, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await rename(source, target);
}

export const migration0004: StorageMigration = {
  id: "0004-dense-event-stream-layout",
  description: "Archive sparse event journals and establish dense streams",
  checksum: migrationChecksum(
    "0004-dense-event-stream-layout|v2|Archive sparse event journals and establish dense streams",
  ),
  async detect(context) {
    return (await pathExists(join(context.paths.home, markerPath)))
      ? "current"
      : "pending";
  },
  async backup(context) {
    return {
      paths: [
        ...(await legacyPaths(context.paths.home)),
        markerPath,
        archiveRoot,
      ],
    };
  },
  async up(context) {
    const home = context.paths.home;
    for (const relative of await legacyPaths(home)) {
      await move(join(home, relative), join(home, archiveRoot, relative));
    }
    context.transaction((database) =>
      database.exec("DROP TABLE IF EXISTS events_index"),
    );
    const marker = join(home, markerPath);
    await mkdir(dirname(marker), { recursive: true, mode: 0o755 });
    await writeFile(
      marker,
      `${JSON.stringify({ migratedAt: context.now().toISOString() })}\n`,
      {
        mode: 0o600,
        flag: "wx",
      },
    ).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
  },
  async verify(context) {
    if (!(await pathExists(join(context.paths.home, markerPath))))
      throw new Error("Dense stream marker is missing.");
    // Dense streams intentionally reuse the canonical event journal paths.
    // Their presence after the marker exists proves normal runtime activity,
    // not that sparse pre-migration journals remain active.
  },
};
