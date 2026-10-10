import { createHash } from "node:crypto";
import type { SelectedPathVerification } from "./selected-path.validation.js";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";

// The archive contains several historical payload versions. Only the destination
// schemas are authoritative; keeping the loose shape here avoids legacy imports.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Legacy = Record<string, any>;
export type LegacyRow = Record<string, SQLOutputValue>;

export function decode(value: SQLOutputValue): Legacy {
  return JSON.parse(
    typeof value === "string"
      ? value
      : Buffer.from(value as Uint8Array).toString("utf8"),
  );
}

export function iso(
  value: unknown,
  fallback = new Date().toISOString(),
): string {
  if (typeof value !== "string" && typeof value !== "number") return fallback;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

export class ImportIds {
  private readonly ids = new Map<string, string>();
  get(prefix: string, old: string): string {
    const key = `${prefix}:${old}`;
    let id = this.ids.get(key);
    if (!id) {
      id = old.startsWith(`${prefix}_`)
        ? old
        : `${prefix}_0${createHash("sha256").update(key).digest("hex").slice(0, 25).toUpperCase()}`;
      this.ids.set(key, id);
    }
    return id;
  }
}

export class LegacyReader {
  readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path, { readOnly: true });
    this.db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 5000");
  }
  *documents(namespace: string): Generator<{ row: LegacyRow; data: Legacy }> {
    // Never enumerate the document table without a namespace predicate: the
    // conversation_state snapshots alone can be hundreds of MB per row.
    for (const row of this.db
      .prepare("SELECT * FROM domain_documents WHERE namespace = ?")
      .iterate(namespace)) {
      yield { row, data: decode(row.data) };
    }
  }
  *records(
    conversationId: string,
    kind?: string,
  ): Generator<{ row: LegacyRow; data: Legacy }> {
    const statement = kind
      ? this.db.prepare(
          "SELECT * FROM conversation_records WHERE conversation_id = ? AND kind = ? ORDER BY sequence",
        )
      : this.db.prepare(
          "SELECT * FROM conversation_records WHERE conversation_id = ? ORDER BY sequence",
        );
    for (const row of kind
      ? statement.iterate(conversationId, kind)
      : statement.iterate(conversationId)) {
      yield { row, data: decode(row.data) };
    }
  }
  record(id: string): Legacy | null {
    const row = this.db
      .prepare("SELECT data FROM conversation_records WHERE id = ?")
      .get(id);
    return row ? decode(row.data) : null;
  }
  hasTable(name: string): boolean {
    return !!this.db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name);
  }
  close(): void {
    this.db.close();
  }
}

export class ImportReport {
  readonly selectedPaths: SelectedPathVerification = {
    roots: 0,
    children: 0,
    userMessageMismatches: [],
    headMismatches: [],
    unansweredToolCalls: 0,
    duplicateToolResults: 0,
    orphanToolResults: 0,
  };
  readonly skipped = new Map<string, number>();
  readonly losses = new Map<string, number>();
  readonly paths: {
    conversationId: string;
    oldLeafId: string | null;
    mappedLeafId: string | null;
    isRoot: boolean;
    label: string;
    oldUserDigests: string[];
  }[] = [];
  readonly missingAssetIds: string[] = [];
  readonly relocatedPayloads: Record<string, string> = {};
  diskFiles = 0;
  trackedFiles = 0;
  missingFiles = 0;
  skip(reason: string, count = 1): void {
    if (count)
      this.skipped.set(reason, (this.skipped.get(reason) ?? 0) + count);
  }
  loss(reason: string): void {
    this.losses.set(reason, (this.losses.get(reason) ?? 0) + 1);
  }
}
