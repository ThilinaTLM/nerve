import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type {
  PermissionException,
  PermissionRuleMatcherKind,
} from "@nervekit/contracts";
import {
  projectPermissionsSchema,
  settingsSchema,
  taskRecordSchema,
} from "@nervekit/contracts";
import { ConversationJournalRepository } from "../../../domains/conversations/conversation-journal.repository.js";
import { CanonicalStore } from "../../canonical-store/canonical-store.js";
import {
  CANONICAL_SCHEMA_CHECKSUM,
  CANONICAL_SCHEMA_SQL,
  CANONICAL_SCHEMA_VERSION,
} from "../../canonical-store/schema.js";
import { pathExists, readJsonFile } from "../../storage/json.js";
import { migrationChecksum } from "../checksum.js";
import type { StorageMigration } from "../migration.js";

const manifest =
  "0017-canonical-sqlite|v1|Create canonical records, events, rules, documents, and schema ledger";

interface LegacyDocument {
  namespace: string;
  scopeId: string;
  documentId: string;
  data: unknown;
}

async function legacySettings(home: string): Promise<unknown | undefined> {
  const file = join(home, "config.json");
  if (!(await pathExists(file))) return undefined;
  const parsed = settingsSchema.safeParse(await readJsonFile<unknown>(file));
  return parsed.success ? parsed.data : undefined;
}

const terminalTaskStatuses = new Set([
  "completed",
  "failed",
  "timed_out",
  "cancelled",
  "orphaned",
  "interrupted",
]);

function decodeLegacyTask(value: unknown): unknown {
  const current = taskRecordSchema.safeParse(value);
  if (current.success) return current.data;
  if (!isRecord(value) || !isRecord(value.runtime))
    return taskRecordSchema.parse(value);
  if (value.runtime.version !== 3) return taskRecordSchema.parse(value);

  const migrated = { ...value };
  delete migrated.runtime;
  if (!terminalTaskStatuses.has(String(value.status))) {
    const migratedAt =
      typeof value.updatedAt === "string"
        ? value.updatedAt
        : new Date(0).toISOString();
    migrated.status = "interrupted";
    migrated.error =
      "Task was interrupted because its legacy worker runtime is no longer supported.";
    migrated.finishedAt = migratedAt;
  }
  return taskRecordSchema.parse(migrated);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function legacyDocuments(home: string): Promise<LegacyDocument[]> {
  const documents: LegacyDocument[] = [];
  for (const [directory, fileName, namespace] of [
    ["projects", "project.json", "project"],
    ["agents", "agent.json", "agent"],
    ["tasks", "task.json", "task"],
  ] as const) {
    const entries = await readdir(join(home, directory), {
      withFileTypes: true,
    }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const file = join(home, directory, entry.name, fileName);
      if (!(await pathExists(file))) continue;
      documents.push({
        namespace,
        scopeId: "global",
        documentId: entry.name,
        data:
          namespace === "task"
            ? decodeLegacyTask(await readJsonFile<unknown>(file))
            : await readJsonFile<unknown>(file),
      });
    }
  }
  const projects = await readdir(join(home, "projects"), {
    withFileTypes: true,
  }).catch(() => []);
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    for (const [fileName, namespace, documentId] of [
      ["task-definitions.json", "task_definitions", "definitions"],
      ["scratch-notes.json", "scratch_notes", "notes"],
    ] as const) {
      const file = join(home, "projects", project.name, fileName);
      if (!(await pathExists(file))) continue;
      documents.push({
        namespace,
        scopeId: project.name,
        documentId,
        data: await readJsonFile<unknown>(file),
      });
    }
  }
  const providers = join(home, "providers.json");
  if (await pathExists(providers)) {
    documents.push({
      namespace: "provider_catalog",
      scopeId: "global",
      documentId: "catalog",
      data: await readJsonFile<unknown>(providers),
    });
  }
  for (const [fileName, namespace, idField] of [
    ["enabled.json", "prompt_suggestion_enablement", "definitionKey"],
    ["trust.json", "prompt_suggestion_trust", "trustId"],
  ] as const) {
    const file = join(home, "prompt-suggestions", fileName);
    if (!(await pathExists(file))) continue;
    const raw = await readJsonFile<unknown>(file);
    const records =
      raw &&
      typeof raw === "object" &&
      !Array.isArray(raw) &&
      Array.isArray((raw as { records?: unknown }).records)
        ? (raw as { records: unknown[] }).records
        : [];
    for (const record of records) {
      if (!record || typeof record !== "object" || Array.isArray(record))
        continue;
      const id = (record as Record<string, unknown>)[idField];
      if (typeof id !== "string") continue;
      documents.push({
        namespace,
        scopeId: "global",
        documentId: id,
        data: record,
      });
    }
  }
  return documents;
}

interface ImportedRule {
  id: string;
  scope: "user" | "project";
  projectId?: string;
  exception: PermissionException;
  timestamp: number;
}

async function legacyRules(home: string, now: Date): Promise<ImportedRule[]> {
  const rules: ImportedRule[] = [];
  const config = join(home, "config.json");
  if (await pathExists(config)) {
    const parsed = settingsSchema.safeParse(
      await readJsonFile<unknown>(config),
    );
    if (parsed.success) {
      for (const exception of parsed.data.permissions.exceptions) {
        rules.push({
          id: canonicalRuleId(exception.id, "user"),
          scope: "user",
          exception,
          timestamp: now.getTime(),
        });
      }
    }
  }
  const projects = await readdir(join(home, "projects"), {
    withFileTypes: true,
  }).catch(() => []);
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const file = join(home, "projects", project.name, "permissions.json");
    if (!(await pathExists(file))) continue;
    const parsed = projectPermissionsSchema.safeParse(
      await readJsonFile<unknown>(file),
    );
    if (!parsed.success) continue;
    for (const exception of parsed.data.exceptions) {
      rules.push({
        id: canonicalRuleId(exception.id, project.name),
        scope: "project",
        projectId: project.name,
        exception,
        timestamp: now.getTime(),
      });
    }
  }
  return rules;
}

function canonicalRuleId(exceptionId: string, scope: string): string {
  return `rule_${scope}_${exceptionId.replace(/^exception_/, "")}`.slice(
    0,
    128,
  );
}

function matcherKind(
  exception: PermissionException,
): PermissionRuleMatcherKind {
  if (["read", "edit", "write", "grep", "find", "ls"].includes(exception.tool))
    return "path_glob";
  if (exception.tool === "bash") return "command_glob";
  if (exception.tool === "web_fetch") return "url_glob";
  return "whole_tool";
}

export const migration0017: StorageMigration = {
  id: "0017-canonical-sqlite",
  description: "Create the canonical SQLite storage baseline",
  checksum: migrationChecksum(manifest),
  async detect(context) {
    if (!(await pathExists(context.paths.sqlitePath))) return "pending";
    return context.withDatabase((database) => {
      const row = database
        .prepare(
          `SELECT 1 AS present FROM sqlite_master
           WHERE type = 'table' AND name = 'schema_migrations'`,
        )
        .get() as { present?: number } | undefined;
      return row?.present === 1 ? "current" : "pending";
    });
  },
  async backup() {
    return {
      paths: [
        "state.sqlite",
        "state.sqlite-wal",
        "state.sqlite-shm",
        "config.json",
        "providers.json",
        "projects",
        "agents",
        "tasks",
        "conversations",
        "prompt-suggestions",
      ],
    };
  },
  async up(context) {
    const now = context.now();
    const rules = await legacyRules(context.paths.home, now);
    const documents = await legacyDocuments(context.paths.home);
    const settings = await legacySettings(context.paths.home);
    context.transaction((database) => {
      database.exec(CANONICAL_SCHEMA_SQL);
      database
        .prepare(
          `INSERT OR IGNORE INTO schema_migrations (
             version, name, checksum, applied_at_ms, duration_ms
           ) VALUES (?, 'dense-durable-event-stream-sequences', ?, ?, 0)`,
        )
        .run(
          CANONICAL_SCHEMA_VERSION,
          CANONICAL_SCHEMA_CHECKSUM,
          now.getTime(),
        );
      if (settings) {
        database
          .prepare(
            `INSERT OR IGNORE INTO settings_store (
               id, revision, payload_version, data, updated_at_ms
             ) VALUES ('settings', 1, 1, ?, ?)`,
          )
          .run(Buffer.from(JSON.stringify(settings)), now.getTime());
      }
      const insertDocument = database.prepare(
        `INSERT OR IGNORE INTO domain_documents (
           namespace, scope_id, document_id, revision, payload_version, data,
           created_at_ms, updated_at_ms
         ) VALUES (?, ?, ?, 1, 1, ?, ?, ?)`,
      );
      for (const document of documents) {
        insertDocument.run(
          document.namespace,
          document.scopeId,
          document.documentId,
          Buffer.from(JSON.stringify(document.data)),
          now.getTime(),
          now.getTime(),
        );
      }
      const insertRule = database.prepare(
        `INSERT OR IGNORE INTO permission_rules (
           id, scope, project_id, effect, tool_name, matcher_kind, pattern,
           enabled, created_at_ms, updated_at_ms
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      );
      for (const rule of rules) {
        insertRule.run(
          rule.id,
          rule.scope,
          rule.projectId ?? null,
          rule.exception.effect,
          rule.exception.tool,
          matcherKind(rule.exception),
          rule.exception.rule,
          rule.timestamp,
          rule.timestamp,
        );
      }
    });
    const store = new CanonicalStore(context.paths.sqlitePath);
    await store.initialize();
    try {
      const importer = new ConversationJournalRepository({
        paths: {
          home: context.paths.home,
          sqlitePath: context.paths.sqlitePath,
        },
        canonicalStore: store,
      });
      const conversations = await readdir(
        join(context.paths.home, "conversations"),
        { withFileTypes: true },
      ).catch(() => []);
      for (const conversation of conversations) {
        if (!conversation.isDirectory()) continue;
        const state = await importer.loadFresh(conversation.name);
        if (state.revision === 0) continue;
        const materialized = context.withDatabase((database) =>
          database
            .prepare(
              `SELECT COUNT(*) AS count FROM conversation_records
               WHERE conversation_id = ?`,
            )
            .get(conversation.name),
        ) as { count: number };
        if (materialized.count === 0 && state.entries.length > 0) {
          throw new Error(
            `Conversation import did not materialize ${conversation.name}.`,
          );
        }
      }
      await store.integrityCheck();
    } finally {
      await store.close();
    }
  },
  async verify(context) {
    context.withDatabase((database) => {
      const row = database
        .prepare(`SELECT checksum FROM schema_migrations WHERE version = ?`)
        .get(CANONICAL_SCHEMA_VERSION) as { checksum?: string } | undefined;
      if (row?.checksum !== CANONICAL_SCHEMA_CHECKSUM) {
        throw new Error("Canonical SQLite baseline is missing or changed.");
      }
      const foreignKeys = database.prepare("PRAGMA foreign_key_check").all();
      if (foreignKeys.length > 0) {
        throw new Error("Canonical SQLite foreign key check failed.");
      }
    });
  },
};
