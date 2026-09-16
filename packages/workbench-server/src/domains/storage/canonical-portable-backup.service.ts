import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import {
  portableBackupManifestSchema,
  type PortableBackupManifest,
} from "@nervekit/contracts/storage";
import type { CanonicalStore } from "../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import type { StoragePaths } from "../../infrastructure/storage-bootstrap/index.js";
import { canonicalConversationJson } from "../conversations/timeline/command-fingerprint.js";

interface BackupEntry {
  kind: "database" | "artifact" | "permission_file";
  ownerId?: string;
  relativeLocator: string;
  digest: string;
  byteLength: number;
  schemaVersion?: string;
}

/** Produces an immutable portable snapshot after external bytes are verified. */
export class CanonicalPortableBackupService {
  constructor(
    private readonly store: CanonicalStore,
    private readonly paths: StoragePaths,
  ) {}

  async create(
    capturedAt = new Date().toISOString(),
    reportProgress?: (message: string) => void,
  ): Promise<{
    manifest: PortableBackupManifest;
    backupPath: string;
  }> {
    const identity = await this.store.readTimelineStateIdentity();
    if (!identity) throw new Error("Canonical state identity is unavailable.");
    const backupId = `backup_${randomUUID()}`;
    const staging = join(this.paths.backupsPath, `.${backupId}.staging`);
    const destination = join(this.paths.backupsPath, backupId);
    await mkdir(staging, { recursive: false, mode: 0o700 });
    try {
      const entries: BackupEntry[] = [];
      const databasePath = join(staging, "database.sqlite");
      reportProgress?.("Creating the migration database snapshot");
      const artifacts =
        await this.store.createTimelineBackupSnapshot(databasePath);
      reportProgress?.("Verifying the migration database snapshot");
      entries.push(await describeFile(databasePath, staging, "database"));
      for (const [artifactIndex, artifact] of artifacts.entries()) {
        reportProgress?.(
          `Copying migration artifacts (${artifactIndex + 1} of ${artifacts.length})`,
        );
        const source = await safeManagedFile(
          this.paths.home,
          artifact.relativeLocator,
        );
        const target = join(staging, "artifacts", artifact.relativeLocator);
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        await copyFile(source, target);
        await syncPath(target);
        const copied = await describeFile(target, staging, "artifact");
        if (
          copied.digest !== artifact.digest ||
          copied.byteLength !== artifact.byteLength
        ) {
          throw new Error(
            `Backup artifact '${artifact.artifactId}' failed verification.`,
          );
        }
        entries.push({
          ...copied,
          ownerId: artifact.ownerId,
        });
      }

      const permissions = await optionalRegularFile(
        this.paths.permissionsConfigPath,
      );
      if (permissions) {
        const target = join(staging, "policy", "permissions.json");
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        await copyStableExternalFile(permissions, target);
        entries.push(await describeFile(target, staging, "permission_file"));
      }

      const entriesPayload = new TextEncoder().encode(
        canonicalConversationJson(entries),
      );
      const entriesLocator = "entries.json";
      const entriesPath = join(staging, entriesLocator);
      await writeFile(entriesPath, entriesPayload, { mode: 0o600 });
      await syncPath(entriesPath);
      const manifestBase = {
        schemaVersion: 1 as const,
        backupId,
        namespaceId: identity.namespaceId,
        sourceExecutionIncarnationId: identity.executionIncarnationId,
        storageFormatVersion: identity.formatVersion,
        entryCount: entries.length,
        entriesManifestLocator: entriesLocator,
        entriesManifestDigest: digestBytes(entriesPayload),
        capturedAt,
      };
      const manifest = portableBackupManifestSchema.parse({
        ...manifestBase,
        manifestDigest: digestBytes(
          new TextEncoder().encode(canonicalConversationJson(manifestBase)),
        ),
      });
      const manifestPath = join(staging, "manifest.json");
      await writeFile(manifestPath, canonicalConversationJson(manifest), {
        mode: 0o600,
      });
      await syncPath(manifestPath);
      await syncPath(staging);
      await rename(staging, destination);
      await syncPath(this.paths.backupsPath);
      return { manifest, backupPath: destination };
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      throw error;
    }
  }
}

async function copyStableExternalFile(
  source: string,
  target: string,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const before = await digestFile(source);
    await copyFile(source, target);
    await syncPath(target);
    const after = await digestFile(source);
    if (before === after && after === (await digestFile(target))) return;
  }
  throw new Error(`External policy file changed during backup: ${source}`);
}

async function describeFile(
  path: string,
  root: string,
  kind: BackupEntry["kind"],
): Promise<BackupEntry> {
  await syncPath(path);
  const stats = await lstat(path);
  return {
    kind,
    relativeLocator: relative(root, path),
    digest: await digestFile(path),
    byteLength: stats.size,
  };
}

async function digestFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return `sha256:${hash.digest("hex")}`;
}

function digestBytes(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function safeManagedFile(home: string, locator: string): Promise<string> {
  const candidate = resolve(home, locator);
  const canonicalHome = await realpath(home);
  const canonical = await realpath(candidate);
  if (
    canonical !== canonicalHome &&
    !canonical.startsWith(`${canonicalHome}${sep}`)
  ) {
    throw new Error(
      `Managed artifact locator escapes storage home: ${locator}`,
    );
  }
  const stats = await lstat(canonical);
  if (!stats.isFile())
    throw new Error(`Managed artifact is not a file: ${locator}`);
  return canonical;
}

async function syncPath(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EINVAL" && code !== "ENOTSUP") throw error;
  } finally {
    await handle.close();
  }
}

async function optionalRegularFile(path: string): Promise<string | undefined> {
  try {
    const stats = await lstat(path);
    return stats.isFile() ? path : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
