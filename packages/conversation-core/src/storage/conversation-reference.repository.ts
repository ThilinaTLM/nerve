import {
  conversationReferenceSchema,
  type ConversationReference,
} from "@nervekit/contracts/core";
import type { CoreDatabase } from "./database.js";

/** Display fields are derived from provider identity, not duplicated in SQL. */
export function referenceFromKey(
  input: Pick<
    ConversationReference,
    "provider" | "resourceKey" | "kind" | "relationship"
  >,
): ConversationReference {
  const github =
    input.provider === "github"
      ? /^([^/]+)\/([^/]+\/[^#]+)#(\d+)$/.exec(input.resourceKey)
      : null;
  return conversationReferenceSchema.parse({
    ...input,
    url: github
      ? `https://${github[1]}/${github[2]}/${input.kind === "pull_request" ? "pull" : "issues"}/${github[3]}`
      : null,
    container: github?.[2] ?? input.resourceKey,
    identifier: github?.[3] ?? input.resourceKey,
  });
}

export class ConversationReferenceRepository {
  constructor(private readonly db: CoreDatabase) {}

  upsert(
    conversationId: string,
    reference: ConversationReference,
    sourceEventId: string,
    createdAt: string,
  ): boolean {
    const value = conversationReferenceSchema.parse(reference);
    const result = this.db.sqlite
      .prepare(`INSERT INTO conversation_reference
      (conversation_id, provider, resource_key, kind, relationship, source_event_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(conversation_id, provider, resource_key) DO UPDATE SET
        relationship = CASE WHEN excluded.relationship = 'created' THEN 'created' ELSE conversation_reference.relationship END,
        kind = CASE WHEN conversation_reference.kind = 'unknown' THEN excluded.kind ELSE conversation_reference.kind END,
        source_event_id = excluded.source_event_id
      WHERE (conversation_reference.relationship = 'referenced' AND excluded.relationship = 'created')
        OR (conversation_reference.kind = 'unknown' AND excluded.kind != 'unknown')`)
      .run(
        conversationId,
        value.provider,
        value.resourceKey,
        value.kind,
        value.relationship,
        sourceEventId,
        createdAt,
      );
    return Number(result.changes) > 0;
  }

  load(conversationIds: string[]): Map<string, ConversationReference[]> {
    const result = new Map<string, ConversationReference[]>();
    if (!conversationIds.length) return result;
    const rows = this.db.sqlite
      .prepare(`SELECT r.* FROM conversation_reference r
      WHERE r.conversation_id IN (SELECT value FROM json_each(?))
      ORDER BY CASE r.relationship WHEN 'created' THEN 0 ELSE 1 END, r.created_at, r.rowid`)
      .all(JSON.stringify(conversationIds));
    for (const row of rows) {
      const id = String(row.conversation_id);
      const references = result.get(id) ?? [];
      const value = referenceFromKey({
        provider: String(row.provider),
        resourceKey: String(row.resource_key),
        kind: String(row.kind),
        relationship: row.relationship as ConversationReference["relationship"],
      });
      references.push(value);
      result.set(id, references);
    }
    return result;
  }
}
