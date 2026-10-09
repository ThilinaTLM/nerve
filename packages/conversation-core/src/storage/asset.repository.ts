import type { SQLOutputValue } from "node:sqlite";
import { type Asset, assetSchema } from "@nervekit/contracts/core";
import type { CoreDatabase } from "./database.js";

export class AssetRepository {
  constructor(private readonly db: CoreDatabase) {}

  get(id: string): Asset | null {
    const row = this.db.sqlite
      .prepare("SELECT * FROM asset WHERE id = ?")
      .get(id);
    return row ? mapAsset(row) : null;
  }

  insert(input: Asset): Asset {
    const row = assetSchema.parse(input);
    this.db.sqlite
      .prepare(
        "INSERT INTO asset (id, conversation_id, event_id, tool_call_id, async_bash_id, category, logical_path, digest, byte_length, media_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        row.id,
        row.conversationId,
        row.eventId,
        row.toolCallId,
        row.asyncBashId,
        row.category,
        row.logicalPath,
        row.digest,
        row.byteLength,
        row.mediaType,
        row.createdAt,
      );
    return row;
  }

  update(
    id: string,
    patch: Partial<Omit<Asset, "id" | "conversationId" | "createdAt">>,
  ): Asset {
    const existing = this.get(id);
    if (!existing) throw new Error(`Asset not found: ${id}`);
    const row = assetSchema.parse({ ...existing, ...patch });
    this.db.sqlite
      .prepare(
        "UPDATE asset SET event_id = ?, tool_call_id = ?, async_bash_id = ?, category = ?, logical_path = ?, digest = ?, byte_length = ?, media_type = ? WHERE id = ?",
      )
      .run(
        row.eventId,
        row.toolCallId,
        row.asyncBashId,
        row.category,
        row.logicalPath,
        row.digest,
        row.byteLength,
        row.mediaType,
        id,
      );
    return row;
  }

  list(conversationId: string): Asset[] {
    return this.db.sqlite
      .prepare(
        "SELECT * FROM asset WHERE conversation_id = ? ORDER BY created_at, id",
      )
      .all(conversationId)
      .map(mapAsset);
  }

  listByEvent(eventId: string): Asset[] {
    return this.db.sqlite
      .prepare("SELECT * FROM asset WHERE event_id = ? ORDER BY created_at, id")
      .all(eventId)
      .map(mapAsset);
  }

  delete(id: string): void {
    this.db.sqlite.prepare("DELETE FROM asset WHERE id = ?").run(id);
  }
}

function mapAsset(row: Record<string, SQLOutputValue>): Asset {
  return assetSchema.parse({
    id: row.id,
    conversationId: row.conversation_id,
    eventId: row.event_id,
    toolCallId: row.tool_call_id,
    asyncBashId: row.async_bash_id,
    category: row.category,
    logicalPath: row.logical_path,
    digest: row.digest,
    byteLength: row.byte_length,
    mediaType: row.media_type,
    createdAt: row.created_at,
  });
}
