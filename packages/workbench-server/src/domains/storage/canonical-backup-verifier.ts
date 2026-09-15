import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  backupManifestEntrySchema,
  portableBackupManifestSchema,
  type PortableBackupManifest,
  type BackupManifestEntry,
} from "@nervekit/contracts/storage";
import { z } from "zod";
import { canonicalConversationJson } from "../conversations/timeline/command-fingerprint.js";

const entriesSchema = z.array(backupManifestEntrySchema).min(1);

/** Verifies a backup completely before any restore staging or promotion. */
export interface VerifiedCanonicalBackup {
  root: string;
  manifest: PortableBackupManifest;
  entries: BackupManifestEntry[];
}

export class CanonicalBackupVerifier {
  async verify(backupPath: string): Promise<PortableBackupManifest> {
    return (await this.verifyBundle(backupPath)).manifest;
  }

  async verifyBundle(backupPath: string): Promise<VerifiedCanonicalBackup> {
    const root = await realpath(backupPath);
    const manifest = portableBackupManifestSchema.parse(
      JSON.parse(await readFile(resolveInside(root, "manifest.json"), "utf8")),
    );
    const { manifestDigest, ...manifestBase } = manifest;
    if (digestJson(manifestBase) !== manifestDigest) {
      throw new Error("Backup manifest digest does not match its contents.");
    }
    const entriesPath = resolveInside(root, manifest.entriesManifestLocator);
    const entriesBytes = await readFile(entriesPath);
    if (digestBytes(entriesBytes) !== manifest.entriesManifestDigest) {
      throw new Error("Backup entries manifest digest does not match.");
    }
    const entries = entriesSchema.parse(JSON.parse(entriesBytes.toString()));
    if (entries.length !== manifest.entryCount) {
      throw new Error("Backup entry count does not match its manifest.");
    }
    const locators = new Set<string>();
    for (const entry of entries) {
      if (locators.has(entry.relativeLocator)) {
        throw new Error(
          `Backup locator is duplicated: ${entry.relativeLocator}`,
        );
      }
      locators.add(entry.relativeLocator);
      const path = resolveInside(root, entry.relativeLocator);
      const stats = await lstat(path);
      if (!stats.isFile() || stats.size !== entry.byteLength) {
        throw new Error(
          `Backup entry size is invalid: ${entry.relativeLocator}`,
        );
      }
      if ((await digestFile(path)) !== entry.digest) {
        throw new Error(
          `Backup entry digest is invalid: ${entry.relativeLocator}`,
        );
      }
    }
    const databaseEntry = entries.find((entry) => entry.kind === "database");
    if (!databaseEntry)
      throw new Error("Backup has no canonical database entry.");
    verifyDatabase(
      resolveInside(root, databaseEntry.relativeLocator),
      manifest,
    );
    return { root, manifest, entries };
  }
}

function verifyDatabase(path: string, manifest: PortableBackupManifest): void {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const integrity = database.prepare("PRAGMA integrity_check").get() as {
      integrity_check: string;
    };
    if (integrity.integrity_check !== "ok") {
      throw new Error(
        `Backup database integrity failed: ${integrity.integrity_check}`,
      );
    }
    const identity = database
      .prepare(
        `SELECT namespace_id, execution_incarnation_id, format_version
         FROM state_identity WHERE singleton = 1`,
      )
      .get() as
      | {
          namespace_id: string;
          execution_incarnation_id: string;
          format_version: number;
        }
      | undefined;
    if (
      !identity ||
      identity.namespace_id !== manifest.namespaceId ||
      identity.execution_incarnation_id !==
        manifest.sourceExecutionIncarnationId ||
      identity.format_version !== manifest.storageFormatVersion
    ) {
      throw new Error("Backup database identity does not match its manifest.");
    }
  } finally {
    database.close();
  }
}

function resolveInside(root: string, locator: string): string {
  const path = resolve(root, locator);
  if (path !== root && !path.startsWith(`${root}${sep}`)) {
    throw new Error(`Backup locator escapes its root: ${locator}`);
  }
  return path;
}

async function digestFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return `sha256:${hash.digest("hex")}`;
}

function digestBytes(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function digestJson(value: unknown): string {
  return digestBytes(
    new TextEncoder().encode(canonicalConversationJson(value)),
  );
}
