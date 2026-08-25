import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  conversationRecordSchema,
  deriveConversationTitle,
  settingsSchema,
} from "@nervekit/contracts";
import { decode, encode } from "../../canonical-store/payload-codecs.js";
import { normalizeSettings } from "../legacy/settings-normalization.js";
import type { CanonicalMigration } from "./definition.js";

export const canonicalMigration0003: CanonicalMigration = {
  version: 3,
  name: "normalize-canonical-data",
  checksum: "0c37fcedf26320bcbc4b7b966a39ccbaa9759fd8295fc3cdc8c850d0c8598367",
  backupPaths: [
    "state.sqlite",
    "state.sqlite-wal",
    "state.sqlite-shm",
    "config.json",
    "providers.json",
    "cache/legacy-index.sqlite",
    "cache/legacy-index.sqlite-wal",
    "cache/legacy-index.sqlite-shm",
  ],
  apply(database) {
    normalizeStoredSettings(database);
    normalizeConversations(database);
  },
  async cleanup(home) {
    await Promise.all(
      [
        "config.json",
        "providers.json",
        "cache/legacy-index.sqlite",
        "cache/legacy-index.sqlite-wal",
        "cache/legacy-index.sqlite-shm",
      ].map((path) => rm(join(home, path), { force: true })),
    );
  },
  verify(database) {
    verifyCanonicalData(database);
  },
};

export function applyCanonicalV3DataMigration(database: DatabaseSync): void {
  canonicalMigration0003.apply(database);
  canonicalMigration0003.verify(database);
}

function normalizeStoredSettings(database: DatabaseSync): void {
  const row = database
    .prepare("SELECT revision, data FROM settings_store WHERE id = 'settings'")
    .get() as { revision: number; data: Uint8Array | string } | undefined;
  if (!row) throw new Error("Canonical settings are missing.");
  const settings = normalizeSettings(decode(row.data)).settings;
  const current = settingsSchema.parse(settings);
  database
    .prepare(
      `UPDATE settings_store
       SET revision = ?, payload_version = 1, data = ?, updated_at_ms = ?
       WHERE id = 'settings'`,
    )
    .run(row.revision + 1, encode(current), Date.now());
}

function normalizeConversations(database: DatabaseSync): void {
  const stateRows = database
    .prepare(
      `SELECT scope_id, revision, data FROM domain_documents
       WHERE namespace = 'conversation_state' AND document_id = 'state'`,
    )
    .all() as unknown as Array<{
    scope_id: string;
    revision: number;
    data: Uint8Array | string;
  }>;
  const conversationDocument = database.prepare(
    `SELECT revision, data FROM domain_documents
     WHERE namespace = 'conversation' AND scope_id = 'global' AND document_id = ?`,
  );
  const updateDocument = database.prepare(
    `UPDATE domain_documents SET revision = ?, data = ?, updated_at_ms = ?
     WHERE namespace = ? AND scope_id = ? AND document_id = ?`,
  );
  for (const row of stateRows) {
    const state = record(decode(row.data));
    if (!state) continue;
    const entries = Array.isArray(state.entries) ? state.entries : [];
    const conversationRow = conversationDocument.get(row.scope_id) as
      | { revision: number; data: Uint8Array | string }
      | undefined;
    const conversation = record(
      conversationRow ? decode(conversationRow.data) : state.conversation,
    );
    if (!conversation) continue;
    const next = repairConversation(conversation, entries);
    conversationRecordSchema.parse(next);
    const now = Date.now();
    updateDocument.run(
      row.revision + 1,
      encode({
        ...state,
        conversation: next,
        revision: Math.max(Number(state.revision) || 0, row.revision + 1),
      }),
      now,
      "conversation_state",
      row.scope_id,
      "state",
    );
    if (conversationRow) {
      updateDocument.run(
        conversationRow.revision + 1,
        encode(next),
        now,
        "conversation",
        "global",
        row.scope_id,
      );
    }
  }
}

function repairConversation(
  conversation: Record<string, unknown>,
  entries: unknown[],
): Record<string, unknown> {
  const userEntries = entries
    .map(record)
    .filter((entry): entry is Record<string, unknown> => entry?.role === "user")
    .filter((entry) => typeof entry.createdAt === "string");
  const lastUserMessageAt = userEntries
    .map((entry) => entry.createdAt as string)
    .sort()
    .at(-1);
  const firstText = userEntries.find(
    (entry) => typeof entry.text === "string",
  )?.text;
  const title =
    typeof conversation.title === "string" && typeof firstText === "string"
      ? expandOldTruncatedTitle(conversation.title, firstText)
      : undefined;
  return {
    ...conversation,
    ...(lastUserMessageAt ? { lastUserMessageAt } : {}),
    ...(title ? { title } : {}),
  };
}

function expandOldTruncatedTitle(
  existingTitle: string,
  firstUserText: string,
): string | undefined {
  const existing = existingTitle.trim();
  if (!/(?:…|\.\.\.)$/u.test(existing)) return undefined;
  const expanded = deriveConversationTitle(firstUserText);
  if (expanded.length <= existing.length) return undefined;
  const stem = existing
    .replace(/\s*(?:…|\.\.\.)$/u, "")
    .replace(/[\s,;:.-]+$/u, "")
    .trim();
  const readable = (stem.match(/[\p{L}\p{N}]/gu) ?? []).length;
  return readable >= 3 && expanded.startsWith(stem) ? expanded : undefined;
}

function verifyCanonicalData(database: DatabaseSync): void {
  const settings = database
    .prepare("SELECT data FROM settings_store WHERE id = 'settings'")
    .get() as { data: Uint8Array | string } | undefined;
  if (!settings) throw new Error("Canonical settings are missing.");
  settingsSchema.parse(decode(settings.data));
  if (database.prepare("PRAGMA foreign_key_check").all().length > 0) {
    throw new Error("Canonical SQLite foreign key check failed.");
  }
  const quick = database.prepare("PRAGMA quick_check").get() as
    | { quick_check?: string }
    | undefined;
  if (quick?.quick_check !== "ok")
    throw new Error("Canonical SQLite quick check failed.");
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
