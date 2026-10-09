import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { coreSchemaV1 } from "./schema.js";
import type { Legacy } from "./legacy.reader.js";

const jsonColumns = new Set([
  "model",
  "payload",
  "arguments",
  "content",
  "command_preparation",
]);
const booleanColumns = new Set(["paused", "wake_when_idle"]);
const column = (name: string) =>
  name === "type"
    ? "event_type"
    : name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
const property = (name: string) =>
  name === "event_type"
    ? "type"
    : name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

/** Frozen SQL writer: only the operations needed by this one conversion. */
export class CoreStorage {
  readonly sqlite: DatabaseSync;
  private readonly statements = new Map<
    string,
    ReturnType<DatabaseSync["prepare"]>
  >();
  constructor(path: string, initialize = true) {
    this.sqlite = new DatabaseSync(path);
    this.sqlite.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000",
    );
    if (initialize)
      this.transaction(() => {
        this.sqlite.exec(
          `CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT`,
        );
        this.sqlite.exec(coreSchemaV1);
        this.sqlite
          .prepare("INSERT INTO schema_migrations VALUES (1, ?, ?, ?)")
          .run(
            "conversation core foundation",
            createHash("sha256").update(coreSchemaV1).digest("hex"),
            new Date().toISOString(),
          );
      });
  }
  private statement(sql: string) {
    let result = this.statements.get(sql);
    if (!result) {
      result = this.sqlite.prepare(sql);
      this.statements.set(sql, result);
    }
    return result;
  }
  private insert(table: string, value: Legacy): void {
    const keys = Object.keys(value);
    this.statement(
      `INSERT INTO ${table} (${keys.map(column).join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
    ).run(
      ...keys.map((key) => {
        const name = column(key),
          item = value[key];
        if (item === undefined) throw new Error(`Missing ${table}.${name}`);
        return jsonColumns.has(name) && item !== null
          ? JSON.stringify(item)
          : booleanColumns.has(name)
            ? Number(item)
            : item;
      }),
    );
  }
  private get(table: string, key: string, id: string): Legacy | null {
    const row = this.statement(`SELECT * FROM ${table} WHERE ${key} = ?`).get(
      id,
    );
    if (!row) return null;
    return Object.fromEntries(
      Object.entries(row).map(([name, value]) => [
        property(name),
        jsonColumns.has(name) && value !== null
          ? JSON.parse(String(value))
          : booleanColumns.has(name)
            ? Boolean(value)
            : value,
      ]),
    );
  }
  readonly projects = {
    insert: (row: Legacy) => this.insert("project", row),
    get: (id: string) => this.get("project", "id", id),
  };
  readonly scratchNotes = {
    insert: (row: Legacy) => this.insert("scratch_note", row),
  };
  readonly assets = { insert: (row: Legacy) => this.insert("asset", row) };
  readonly asyncBash = {
    insert: (row: Legacy) => this.insert("async_bash", row),
  };
  readonly events = {
    insert: (row: Legacy) => this.insert("conversation_event", row),
    get: (id: string) => this.get("conversation_event", "id", id),
  };
  readonly trustedResources = {
    insert: (row: Legacy) => this.insert("trusted_resource", row),
    find: (
      kind: string,
      projectId: string | null,
      path: string,
    ): Legacy | null => {
      const row = this.statement(
        "SELECT id FROM trusted_resource WHERE kind = ? AND project_id IS ? AND path = ?",
      ).get(kind, projectId, path);
      return row ? this.get("trusted_resource", "id", String(row.id)) : null;
    },
  };
  readonly conversations = {
    insert: (row: Legacy, config: Legacy) => {
      this.insert("conversation", row);
      this.insert("conversation_config", config);
    },
    get: (id: string) => this.get("conversation", "id", id),
    getConfig: (id: string) =>
      this.get("conversation_config", "conversation_id", id),
    update: (id: string, patch: Legacy) => {
      const keys = Object.keys(patch);
      this.statement(
        `UPDATE conversation SET ${keys.map((key) => `${column(key)} = ?`).join(",")} WHERE id = ?`,
      ).run(...keys.map((key) => patch[key]), id);
    },
  };
  readonly inputs = {
    insert: (row: Legacy) => {
      const owner = this.conversations.get(row.conversationId)!;
      this.insert("input_queue", {
        ...row,
        acceptanceSequence: owner.nextInputSequence,
      });
      this.conversations.update(row.conversationId, {
        nextInputSequence: owner.nextInputSequence + 1,
      });
    },
  };
  transaction<T>(fn: () => T): T {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.sqlite.exec("COMMIT");
      return result;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
  close(): void {
    this.sqlite.close();
  }
}
export const openCoreStorage = (path: string) => new CoreStorage(path);
