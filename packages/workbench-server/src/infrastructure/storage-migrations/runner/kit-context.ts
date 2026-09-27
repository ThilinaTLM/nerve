import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { MigrationFilesV1 } from "../kit/files/v1.js";
import type { JsonObjectV1 } from "../kit/json/v1.js";
import { parseJsonObjectV1, encodeJsonV1 } from "../kit/json/v1.js";
import type {
  MigrationDocumentWriteV1,
  MigrationRowsV1,
} from "../kit/rows/v1.js";
import {
  quarantineCandidate,
  type QuarantineRecordClass,
} from "./quarantine.js";

export function createMigrationRows(input: {
  database: DatabaseSync;
  sourceStep: string;
  recordClass: QuarantineRecordClass;
  nowMs: number;
  onRecord(bytes: number): void;
  onQuarantine(
    id: string,
    recordClass: QuarantineRecordClass,
    bytes: number,
  ): void;
}): MigrationRowsV1 {
  return {
    async eachDocument(namespace, shape, visit, options = {}) {
      const batchSize = options.batchSize ?? 500;
      let afterScope = "";
      let afterDocument = "";
      while (true) {
        const rows = input.database
          .prepare(
            `SELECT namespace, scope_id, document_id, revision, payload_version, data
             FROM domain_documents
             WHERE namespace = ? AND (? IS NULL OR scope_id = ?)
               AND (scope_id > ? OR (scope_id = ? AND document_id > ?))
             ORDER BY scope_id, document_id LIMIT ?`,
          )
          .all(
            namespace,
            options.scopeId ?? null,
            options.scopeId ?? null,
            afterScope,
            afterScope,
            afterDocument,
            batchSize,
          ) as unknown as Array<{
          namespace: string;
          scope_id: string;
          document_id: string;
          revision: number;
          payload_version: number;
          data: Uint8Array | string;
        }>;
        if (rows.length === 0) break;
        input.database.exec("BEGIN IMMEDIATE");
        try {
          for (const row of rows) {
            const rowBytes =
              typeof row.data === "string"
                ? Buffer.byteLength(row.data)
                : row.data.byteLength;
            input.onRecord(rowBytes);
            const savepoint = `record_${createHash("sha256")
              .update(`${row.scope_id}\0${row.document_id}`)
              .digest("hex")
              .slice(0, 16)}`;
            input.database.exec(`SAVEPOINT ${savepoint}`);
            try {
              const raw = parseJsonObjectV1(row.data);
              const parsed = shape(raw);
              let replacement: {
                data: JsonObjectV1;
                payloadVersion: number;
              } | null = null;
              const write: MigrationDocumentWriteV1 = {
                merge(patch) {
                  replacement = {
                    data: { ...raw, ...patch },
                    payloadVersion: row.payload_version,
                  };
                },
                replace(data, payloadVersion = row.payload_version) {
                  replacement = { data, payloadVersion };
                },
              };
              await visit(
                {
                  namespace: row.namespace,
                  scopeId: row.scope_id,
                  documentId: row.document_id,
                  revision: row.revision,
                  payloadVersion: row.payload_version,
                  data: parsed,
                },
                write,
              );
              if (replacement) {
                const next = replacement as {
                  data: JsonObjectV1;
                  payloadVersion: number;
                };
                const updated = input.database
                  .prepare(
                    `UPDATE domain_documents SET data = ?, payload_version = ?,
                       revision = revision + 1, updated_at_ms = ?
                     WHERE namespace = ? AND scope_id = ? AND document_id = ?`,
                  )
                  .run(
                    encodeJsonV1(next.data),
                    next.payloadVersion,
                    input.nowMs,
                    namespace,
                    row.scope_id,
                    row.document_id,
                  );
                if (updated.changes !== 1) {
                  throw new Error(
                    "Migration document disappeared during update.",
                  );
                }
              }
              input.database.exec(`RELEASE ${savepoint}`);
            } catch (error) {
              input.database.exec(`ROLLBACK TO ${savepoint}`);
              input.database.exec(`RELEASE ${savepoint}`);
              const original =
                typeof row.data === "string"
                  ? row.data
                  : new Uint8Array(row.data);
              const id = quarantineCandidate(
                input.database,
                {
                  sourceStep: input.sourceStep,
                  unit: "record",
                  recordClass: input.recordClass,
                  source: `domain_documents:${namespace}`,
                  sourceKey: `${row.scope_id}/${row.document_id}`,
                  reason:
                    error instanceof Error ? error.message : String(error),
                  original,
                  affectedRecords: 1,
                  affectedBytes:
                    typeof original === "string"
                      ? Buffer.byteLength(original)
                      : original.byteLength,
                  createdAtMs: input.nowMs,
                },
                () => {
                  input.database
                    .prepare(
                      `DELETE FROM domain_documents
                       WHERE namespace = ? AND scope_id = ? AND document_id = ?`,
                    )
                    .run(namespace, row.scope_id, row.document_id);
                },
              );
              input.onQuarantine(id, input.recordClass, rowBytes);
            }
          }
          input.database.exec("COMMIT");
        } catch (error) {
          input.database.exec("ROLLBACK");
          throw error;
        }
        const last = rows.at(-1)!;
        afterScope = last.scope_id;
        afterDocument = last.document_id;
      }
    },
  };
}

export function createMigrationFiles(input: {
  home: string;
  staging: string;
}): MigrationFilesV1 {
  return {
    async read(relativePath) {
      const source = confined(input.home, relativePath);
      await assertNoSymlink(input.home, relativePath);
      try {
        return new Uint8Array(await readFile(source));
      } catch (error) {
        if (errorCode(error) === "ENOENT") return undefined;
        throw error;
      }
    },
    async list(relativeDirectory) {
      const source = confined(input.home, relativeDirectory);
      await assertNoSymlink(input.home, relativeDirectory);
      const entries = await readdir(source, { withFileTypes: true }).catch(
        (error) => {
          if (errorCode(error) === "ENOENT") return [];
          throw error;
        },
      );
      return entries.map((entry) => entry.name).sort();
    },
    async create(relativePath, bytes) {
      await assertNoSymlink(input.home, relativePath);
      const live = await readFile(confined(input.home, relativePath)).catch(
        (error) => {
          if (errorCode(error) === "ENOENT") return undefined;
          throw error;
        },
      );
      if (live) {
        if (!Buffer.from(live).equals(Buffer.from(bytes))) {
          throw new Error(`Live migration file conflict at ${relativePath}.`);
        }
        return;
      }
      const target = confined(input.staging, relativePath);
      const existing = await readFile(target).catch((error) => {
        if (errorCode(error) === "ENOENT") return undefined;
        throw error;
      });
      if (existing) {
        if (!Buffer.from(existing).equals(Buffer.from(bytes))) {
          throw new Error(`Staged migration file conflict at ${relativePath}.`);
        }
        return;
      }
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
    },
    async exists(relativePath) {
      await assertNoSymlink(input.home, relativePath);
      const staged = confined(input.staging, relativePath);
      if (
        await stat(staged)
          .then(() => true)
          .catch(() => false)
      )
        return true;
      return stat(confined(input.home, relativePath))
        .then(() => true)
        .catch(() => false);
    },
    async sha256(bytes) {
      return createHash("sha256").update(bytes).digest("hex");
    },
  };
}

async function assertNoSymlink(root: string, path: string): Promise<void> {
  let current = root;
  for (const segment of path.split(/[\\/]/).filter(Boolean)) {
    current = resolve(current, segment);
    const info = await lstat(current).catch((error) => {
      if (errorCode(error) === "ENOENT") return undefined;
      throw error;
    });
    if (!info) return;
    if (info.isSymbolicLink()) {
      throw new Error(`Migration files cannot traverse a symlink: ${current}`);
    }
  }
}

function confined(root: string, path: string): string {
  if (!path || isAbsolute(path))
    throw new Error("Migration path must be relative.");
  const target = resolve(root, path);
  const offset = relative(resolve(root), target);
  if (offset === ".." || offset.startsWith(`..${sep}`) || isAbsolute(offset)) {
    throw new Error("Migration path escapes its workspace.");
  }
  return target;
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}
