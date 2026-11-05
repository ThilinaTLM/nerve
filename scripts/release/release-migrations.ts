import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  hashStepFolder,
  type MigrationLock,
} from "../../packages/workbench-server/src/infrastructure/migrations/framework/lock.ts";
import { assertReleaseVersion } from "./release-version.ts";

const MIGRATIONS_PATH = join(
  "packages",
  "workbench-server",
  "src",
  "infrastructure",
  "migrations",
);
export const MIGRATION_LOCK_PATH = join(
  MIGRATIONS_PATH,
  "migrations.lock.json",
);
export const MIGRATION_METADATA_PATH = join(
  MIGRATIONS_PATH,
  "framework",
  "registry-metadata.ts",
);

/** One draft step that the release turns into an immutable released step. */
export interface MigrationRelease {
  id: string;
  /** Hash of the step folder: the released checksum. */
  checksum: string;
  /**
   * The draft's recorded checksum when it no longer matches its files. Homes
   * that applied the draft recorded it, so it stays admitted as a previous checksum.
   */
  staleLabel?: string;
}

/** Pure planning: which draft entries are released, and whether their label drifted. */
export function planMigrationRelease(
  lock: MigrationLock,
  folderHashes: ReadonlyMap<string, string>,
): MigrationRelease[] {
  return Object.entries(lock)
    .filter(([, entry]) => entry.stage === "draft")
    .map(([id, entry]) => {
      const checksum = folderHashes.get(id);
      if (!checksum) throw new Error(`Missing migration step folder: ${id}`);
      return checksum === entry.checksum
        ? { id, checksum }
        : { id, checksum, staleLabel: entry.checksum };
    });
}

function releasedPrevious(
  previous: readonly string[] | undefined,
  release: MigrationRelease,
): string[] | undefined {
  const next = [...(previous ?? [])];
  if (release.staleLabel && !next.includes(release.staleLabel))
    next.push(release.staleLabel);
  return next.length ? next : undefined;
}

export function applyReleaseToLock(
  lock: MigrationLock,
  releases: readonly MigrationRelease[],
  version: string,
): MigrationLock {
  const next: MigrationLock = structuredClone(lock);
  for (const release of releases) {
    const previousChecksums = releasedPrevious(
      next[release.id]?.previousChecksums,
      release,
    );
    next[release.id] = {
      checksum: release.checksum,
      stage: "released",
      releasedIn: version,
      ...(previousChecksums ? { previousChecksums } : {}),
    };
  }
  return next;
}

/** Replace one entry's checksum in `registry-metadata.ts` source. */
export function setMetadataChecksum(
  source: string,
  id: string,
  checksum: string,
): string {
  const start = source.indexOf(`id: "${id}"`);
  if (start < 0) throw new Error(`registry-metadata.ts has no entry for ${id}`);
  const end = source.indexOf("\n    }", start);
  const block = source.slice(start, end);
  const next = block.replace(
    /checksum:\s*"[a-f0-9]{64}",/,
    `checksum:\n        "${checksum}",`,
  );
  if (next === block && !block.includes(checksum))
    throw new Error(`Could not locate the checksum for ${id}`);
  return source.slice(0, start) + next + source.slice(end);
}

/**
 * Refresh every draft step's recorded checksum to its folder hash in both the
 * lock and the registry metadata (`pnpm storage:checksums`). Released steps are
 * never touched; their folders must not change.
 */
export async function updateDraftChecksums(
  rootDirectory: string,
): Promise<Array<{ id: string; from: string; to: string }>> {
  const lockPath = join(rootDirectory, MIGRATION_LOCK_PATH);
  const metadataPath = join(rootDirectory, MIGRATION_METADATA_PATH);
  const lock = JSON.parse(await readFile(lockPath, "utf8")) as MigrationLock;
  let metadata = await readFile(metadataPath, "utf8");
  const updates: Array<{ id: string; from: string; to: string }> = [];
  for (const [id, entry] of Object.entries(lock)) {
    if (entry.stage !== "draft") continue;
    const hash = await hashStepFolder(
      join(rootDirectory, MIGRATIONS_PATH, "steps", id),
    );
    if (hash === entry.checksum) continue;
    updates.push({ id, from: entry.checksum, to: hash });
    entry.checksum = hash;
    metadata = setMetadataChecksum(metadata, id, hash);
  }
  if (updates.length) {
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    await writeFile(metadataPath, metadata);
  }
  return updates;
}

/**
 * Rewrite the matching entries of `registry-metadata.ts`. The file is an
 * ordered literal of `{ step: { id }, checksum, previousChecksums?, stage,
 * releasedIn?, rerunOnChange? }` objects; only the released entries change.
 */
export function applyReleaseToMetadataSource(
  source: string,
  releases: readonly MigrationRelease[],
  version: string,
): string {
  let next = source;
  for (const release of releases) {
    const start = next.indexOf(`id: "${release.id}"`);
    if (start < 0)
      throw new Error(`registry-metadata.ts has no entry for ${release.id}`);
    const blockStart = next.lastIndexOf(
      "{\n",
      next.lastIndexOf("step:", start),
    );
    const blockEnd = next.indexOf("\n    }", start);
    if (blockStart < 0 || blockEnd < 0)
      throw new Error(`Could not locate the registry entry for ${release.id}`);
    let block = next.slice(blockStart, blockEnd);
    if (!/stage: "draft",/.test(block))
      throw new Error(`${release.id} is not a draft in registry-metadata.ts`);

    block = block.replace(
      /checksum:\s*"[a-f0-9]{64}",/,
      `checksum:\n        "${release.checksum}",`,
    );
    block = block.replace(/\n\s*rerunOnChange: (true|false),/, "");
    if (release.staleLabel && !block.includes(release.staleLabel)) {
      const existing = /previousChecksums: \[([\s\S]*?)\],/.exec(block);
      block = existing
        ? block.replace(
            existing[0],
            `previousChecksums: [${existing[1].replace(/,?\s*$/, ",")}\n        "${release.staleLabel}",\n      ],`,
          )
        : block.replace(
            /(checksum:\n\s*"[a-f0-9]{64}",)/,
            `$1\n      // Draft label recorded by homes that applied the pre-release revision.\n      previousChecksums: ["${release.staleLabel}"],`,
          );
    }
    block = block.replace(
      'stage: "draft",',
      `stage: "released",\n      releasedIn: "${version}",`,
    );
    next = next.slice(0, blockStart) + block + next.slice(blockEnd);
  }
  return next;
}

/**
 * Mark every draft migration step released in `version`, in both the lock and
 * the registry metadata. Returns the released steps and the files written
 * (none when `dryRun`).
 */
export async function releaseDraftMigrations(
  rootDirectory: string,
  version: string,
  { dryRun = false }: { dryRun?: boolean } = {},
): Promise<{ releases: MigrationRelease[]; changedPaths: string[] }> {
  assertReleaseVersion(version);
  const lockPath = join(rootDirectory, MIGRATION_LOCK_PATH);
  const metadataPath = join(rootDirectory, MIGRATION_METADATA_PATH);
  const lock = JSON.parse(await readFile(lockPath, "utf8")) as MigrationLock;
  const hashes = new Map<string, string>();
  for (const [id, entry] of Object.entries(lock))
    if (entry.stage === "draft")
      hashes.set(
        id,
        await hashStepFolder(join(rootDirectory, MIGRATIONS_PATH, "steps", id)),
      );
  const releases = planMigrationRelease(lock, hashes);
  if (!releases.length || dryRun) return { releases, changedPaths: [] };

  const metadata = applyReleaseToMetadataSource(
    await readFile(metadataPath, "utf8"),
    releases,
    version,
  );
  await writeFile(
    lockPath,
    `${JSON.stringify(applyReleaseToLock(lock, releases, version), null, 2)}\n`,
  );
  await writeFile(metadataPath, metadata);
  return {
    releases,
    changedPaths: [MIGRATION_LOCK_PATH, MIGRATION_METADATA_PATH],
  };
}
