import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export interface StorageSnapshotInfo {
  path: string;
  createdAtMs: number;
  bytes: number;
  pruneCandidate: boolean;
}

export async function listStorageSnapshots(
  storageBackupsPath: string,
  options: {
    nowMs?: number;
    minimumRetained?: number;
    retainDays?: number;
  } = {},
): Promise<StorageSnapshotInfo[]> {
  const entries = await readdir(storageBackupsPath, {
    withFileTypes: true,
  }).catch(() => []);
  const snapshots = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const path = join(storageBackupsPath, entry.name);
        const info = await stat(path);
        return {
          path,
          createdAtMs: timestampFromName(entry.name) ?? info.mtimeMs,
          bytes: await directoryBytes(path),
        };
      }),
  );
  snapshots.sort((left, right) => right.createdAtMs - left.createdAtMs);
  const cutoff =
    (options.nowMs ?? Date.now()) -
    (options.retainDays ?? 14) * 24 * 60 * 60 * 1000;
  const minimumRetained = options.minimumRetained ?? 3;
  return snapshots.map((snapshot, index) => ({
    ...snapshot,
    pruneCandidate: index >= minimumRetained && snapshot.createdAtMs < cutoff,
  }));
}

async function directoryBytes(path: string): Promise<number> {
  let bytes = 0;
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) bytes += await directoryBytes(child);
    else if (entry.isFile()) bytes += (await stat(child)).size;
  }
  return bytes;
}

function timestampFromName(name: string): number | undefined {
  const match = /^(\d{8}T\d{9}Z)-before-/.exec(name);
  if (!match) return undefined;
  const stamp = match[1];
  const iso = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}.${stamp.slice(15, 18)}Z`;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : undefined;
}
