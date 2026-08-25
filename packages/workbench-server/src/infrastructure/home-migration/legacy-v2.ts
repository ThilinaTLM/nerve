import { createDecipheriv } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  legacyV2HomeMarkerSchema,
  settingsSchema,
  type Settings,
} from "@nervekit/contracts";
import { DatabaseSync } from "node:sqlite";

export type LegacyV2Layout = "released-post-0012" | "canonical-v3";

export type LegacyV2Inspection =
  | { kind: "legacy-v2"; layout: LegacyV2Layout }
  | { kind: "not-legacy-v2"; reason: string };

const RELEASED_POST_0012_MIGRATIONS = [
  [
    "0001-v2-storage-baseline",
    "646383f6935f66d0c5c1b042d80ea8e702e86d67d9263039dba5fb462b1ddc96",
  ],
  [
    "0002-current-index-baseline",
    "4b4d10daff301048d8e70a0d369bb845e4dbbec2d936c32d72c43da05171abe6",
  ],
  [
    "0003-normalize-current-settings",
    "d460d9e329229cf93025998068e7810d93caacfe6aadf61262c242f011e9d14f",
  ],
  [
    "0004-dense-event-stream-layout",
    "e6ae6867a7d8816b712ba1ef254618da9cc6774513c5bdcbdcff07376a660544",
  ],
  [
    "0005-current-project-sidecars",
    "3bea84b38581b92f0f7598bb4f10811af528ed161fe8699114e0ac00ecdb4a09",
  ],
  [
    "0006-unify-tool-call-lifecycle",
    "152c460d43700f6a55ca0538ca559be7397230a7b4c567df5e1e8febf5e018e9",
  ],
  [
    "0007-transient-conversation-live-events",
    "b8dda574e9aef9d1dd408fb11ad3226522b82fce30d350fa4b0cfccaf5049fb8",
  ],
  [
    "0008-remove-legacy-storage",
    "6937a67a4a9b9bef2587389499cc4ed481657099f94493c48fa34b3c2c8b5ad7",
  ],
  [
    "0009-native-task-runtimes",
    "9ffeb8cff1ad20c8dd98913f48abe550de7c631228a651540675d77c9cb251a1",
  ],
  [
    "0010-integration-provider-profiles",
    "67ead85c0933441701439fa2e28052ba464870bf07e78868a4c1fc9dd656e4af",
  ],
  [
    "0011-import-legacy-portable-state",
    "63d0b5a725277e46965482eb1f178788d86ae081f143d311383ce15d3fdfffd7",
  ],
  [
    "0012-remove-workers",
    "2d85acfc3ea8bfe601da671d65280b114542a52ffd14a044b674bfb1e8090d5b",
  ],
] as const;

export async function inspectLegacyV2Home(
  home: string,
): Promise<LegacyV2Inspection> {
  const markerPath = join(home, "VERSION");
  const markerInfo = await lstat(markerPath).catch((error) => {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  });
  if (!markerInfo || !markerInfo.isFile() || markerInfo.isSymbolicLink()) {
    return {
      kind: "not-legacy-v2",
      reason: "The home has no regular legacy v2 VERSION marker.",
    };
  }
  let value: unknown;
  try {
    value = JSON.parse(await readFile(markerPath, "utf8"));
  } catch {
    return {
      kind: "not-legacy-v2",
      reason: "The legacy VERSION marker is invalid.",
    };
  }
  if (!legacyV2HomeMarkerSchema.safeParse(value).success) {
    return {
      kind: "not-legacy-v2",
      reason: "Only nerve-workbench-state version 2 can be migrated.",
    };
  }
  const post0012 = await hasReleasedPost0012Ledger(home);
  const canonicalV3 = hasCanonicalV3Database(join(home, "state.sqlite"));
  if (post0012 && canonicalV3) {
    return {
      kind: "not-legacy-v2",
      reason:
        "The legacy home has an ambiguous post-0012 ledger and canonical-v3 database.",
    };
  }
  if (post0012) return { kind: "legacy-v2", layout: "released-post-0012" };
  if (canonicalV3) return { kind: "legacy-v2", layout: "canonical-v3" };
  return {
    kind: "not-legacy-v2",
    reason:
      "Only a released Nerve 0.26 home through migration 0012 or a canonical-v3 legacy home can be migrated.",
  };
}

async function hasReleasedPost0012Ledger(home: string): Promise<boolean> {
  let raw: unknown;
  try {
    raw = JSON.parse(
      await readFile(join(home, "migrations", "ledger.json"), "utf8"),
    );
  } catch {
    return false;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const ledger = raw as {
    format?: unknown;
    version?: unknown;
    applied?: unknown;
  };
  if (
    ledger.format !== "nerve-storage-migrations" ||
    ledger.version !== 1 ||
    !Array.isArray(ledger.applied) ||
    ledger.applied.length !== RELEASED_POST_0012_MIGRATIONS.length
  ) {
    return false;
  }
  const applied = ledger.applied;
  return RELEASED_POST_0012_MIGRATIONS.every(([id, checksum], index) => {
    const entry = applied[index];
    return (
      entry !== null &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      (entry as { id?: unknown }).id === id &&
      (entry as { checksum?: unknown }).checksum === checksum
    );
  });
}

function hasCanonicalV3Database(path: string): boolean {
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(path, { readOnly: true });
    const row = database
      .prepare(
        "SELECT checksum FROM schema_migrations WHERE version = ? ORDER BY applied_at_ms DESC LIMIT 1",
      )
      .get(LEGACY_SCHEMA_VERSION) as { checksum?: unknown } | undefined;
    return row?.checksum === LEGACY_SCHEMA_CHECKSUM;
  } catch {
    return false;
  } finally {
    database?.close();
  }
}

export async function assertLegacyDaemonStopped(home: string): Promise<void> {
  const daemonPath = join(home, "daemon.json");
  const info = await lstat(daemonPath).catch(() => undefined);
  if (!info) return;
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error("Legacy daemon metadata is not a regular file.");
  }
  let pid: number | undefined;
  try {
    const value = JSON.parse(await readFile(daemonPath, "utf8")) as {
      pid?: unknown;
    };
    if (typeof value.pid === "number" && Number.isSafeInteger(value.pid)) {
      pid = value.pid;
    }
  } catch {
    throw new Error(
      "Legacy daemon metadata is invalid; no files were changed.",
    );
  }
  if (!pid) return;
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (errorCode(error) === "ESRCH") return;
    if (errorCode(error) !== "EPERM") throw error;
  }
  throw new Error(
    `A legacy Nerve daemon (PID ${pid}) is still running. Quit it before migration; no files were changed.`,
  );
}

const LEGACY_SCHEMA_VERSION = 3;
const LEGACY_SCHEMA_CHECKSUM =
  "0c37fcedf26320bcbc4b7b966a39ccbaa9759fd8295fc3cdc8c850d0c8598367";

export function openValidatedLegacyDatabase(path: string): DatabaseSync {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    database.exec("PRAGMA query_only = ON");
    const row = database
      .prepare(
        "SELECT checksum FROM schema_migrations WHERE version = ? ORDER BY applied_at_ms DESC LIMIT 1",
      )
      .get(LEGACY_SCHEMA_VERSION) as { checksum?: unknown } | undefined;
    if (row?.checksum !== LEGACY_SCHEMA_CHECKSUM) {
      throw new Error(
        "The legacy SQLite schema is not the supported v2 schema.",
      );
    }
    const integrity = database.prepare("PRAGMA integrity_check").get() as {
      integrity_check?: unknown;
    };
    if (integrity.integrity_check !== "ok") {
      throw new Error("The legacy SQLite database failed its integrity check.");
    }
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

export function readLegacySettings(database: DatabaseSync): Settings {
  const row = database
    .prepare("SELECT data FROM settings_store WHERE id = 'settings'")
    .get() as { data?: unknown } | undefined;
  if (!row?.data) throw new Error("The legacy settings record is missing.");
  return settingsSchema.parse(decodeBlob(row.data));
}

export function readLegacyDocument<T>(
  database: DatabaseSync,
  namespace: string,
  scopeId: string,
  documentId: string,
): T | undefined {
  const row = database
    .prepare(
      `SELECT data FROM domain_documents
       WHERE namespace = ? AND scope_id = ? AND document_id = ?`,
    )
    .get(namespace, scopeId, documentId) as { data?: unknown } | undefined;
  return row?.data ? (decodeBlob(row.data) as T) : undefined;
}

export function decodeBlob(value: unknown): unknown {
  const text = Buffer.isBuffer(value)
    ? value.toString("utf8")
    : value instanceof Uint8Array
      ? Buffer.from(value).toString("utf8")
      : String(value);
  return JSON.parse(text) as unknown;
}

export async function readLegacyCredentials(
  home: string,
): Promise<Map<string, string>> {
  const keyPath = join(home, "keys", "master.key");
  const storePath = join(home, "keys", "secrets.json.enc");
  const [keyInfo, storeInfo] = await Promise.all([
    lstat(keyPath).catch(() => undefined),
    lstat(storePath).catch(() => undefined),
  ]);
  if (!keyInfo && !storeInfo) return new Map();
  if (
    !keyInfo?.isFile() ||
    keyInfo.isSymbolicLink() ||
    !storeInfo?.isFile() ||
    storeInfo.isSymbolicLink()
  ) {
    throw new Error("Legacy encrypted credential storage is incomplete.");
  }
  const key = Buffer.from((await readFile(keyPath, "utf8")).trim(), "base64");
  if (key.byteLength !== 32)
    throw new Error("The legacy master key is invalid.");
  const envelope = JSON.parse(await readFile(storePath, "utf8")) as {
    iv?: unknown;
    tag?: unknown;
    data?: unknown;
  };
  if (
    typeof envelope.iv !== "string" ||
    typeof envelope.tag !== "string" ||
    typeof envelope.data !== "string"
  ) {
    throw new Error("The legacy credential envelope is invalid.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(envelope.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const raw = JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(envelope.data, "base64")),
      decipher.final(),
    ]).toString("utf8"),
  ) as unknown;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("The legacy credential payload is invalid.");
  }
  const credentials = new Map<string, string>();
  for (const [name, value] of Object.entries(raw)) {
    if (
      /^provider:.+:(?:apiKey|oauth)$/.test(name) &&
      typeof value === "string"
    ) {
      credentials.set(name, value);
    }
  }
  return credentials;
}

export async function childRegularFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  async function visit(directory: string, relative: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true }).catch(
      (error) => {
        if (errorCode(error) === "ENOENT") return [];
        throw error;
      },
    );
    for (const entry of entries) {
      const childRelative = relative ? join(relative, entry.name) : entry.name;
      if (entry.isSymbolicLink()) {
        throw new Error(`Legacy managed file '${childRelative}' is a symlink.`);
      }
      if (entry.isDirectory())
        await visit(join(directory, entry.name), childRelative);
      else if (entry.isFile()) result.push(childRelative);
    }
  }
  await visit(root, "");
  return result.sort();
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}
