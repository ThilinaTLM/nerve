import type { DatabaseSync } from "node:sqlite";
import type {
  ToolCallRecord,
  ToolCallTranscriptRecord,
} from "@nervekit/contracts";

export const TOOL_CALL_HYDRATION_SCHEMA_VERSION = 1;
const META_KEY = "tool-call-hydration";

export interface ToolCallHydrationSnapshot {
  state: "invalid" | "ready";
  schemaVersion: number;
  migrationFingerprint: string;
  generation: number;
  canonicalCount: number;
  hydrationCount: number;
}

/** Owns the disposable SQLite projections derived from canonical tool calls. */
export class ToolCallHydrationIndex {
  constructor(private readonly db: DatabaseSync) {}

  upsert(toolCall: ToolCallRecord, preview: ToolCallTranscriptRecord): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.writePreview(toolCall, preview);
      this.writeHydration(toolCall);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  readSnapshot(): ToolCallHydrationSnapshot | undefined {
    const row = this.db
      .prepare("SELECT value FROM index_meta WHERE key = ?")
      .get(META_KEY) as { value: string } | undefined;
    if (!row) return undefined;
    try {
      const value = JSON.parse(row.value) as Partial<ToolCallHydrationSnapshot>;
      if (
        (value.state !== "invalid" && value.state !== "ready") ||
        !Number.isInteger(value.schemaVersion) ||
        typeof value.migrationFingerprint !== "string" ||
        !Number.isInteger(value.generation) ||
        !Number.isInteger(value.canonicalCount) ||
        !Number.isInteger(value.hydrationCount)
      )
        return undefined;
      return value as ToolCallHydrationSnapshot;
    } catch {
      return undefined;
    }
  }

  listHydrationJson(): string[] {
    return (
      this.db
        .prepare("SELECT record_json FROM tool_call_hydration ORDER BY id")
        .all() as Array<{ record_json: string }>
    ).map((row) => row.record_json);
  }

  invalidate(): void {
    const current = this.readSnapshot();
    this.writeSnapshot({
      state: "invalid",
      schemaVersion: TOOL_CALL_HYDRATION_SCHEMA_VERSION,
      migrationFingerprint: current?.migrationFingerprint ?? "",
      generation: current?.generation ?? 0,
      canonicalCount: current?.canonicalCount ?? 0,
      hydrationCount: current?.hydrationCount ?? 0,
    });
  }

  markReady(migrationFingerprint: string): void {
    this.writeSnapshot(this.readySnapshot(migrationFingerprint));
  }

  beginRebuild(): void {
    this.invalidate();
    this.db.exec("BEGIN IMMEDIATE");
    this.db.exec("DELETE FROM tool_calls");
    this.db.exec("DELETE FROM tool_call_hydration");
  }

  appendRebuild(
    toolCall: ToolCallRecord,
    preview: ToolCallTranscriptRecord,
  ): void {
    this.writePreview(toolCall, preview);
    this.writeHydration(toolCall);
  }

  finishRebuild(migrationFingerprint: string): void {
    this.writeSnapshot(this.readySnapshot(migrationFingerprint));
    this.db.exec("COMMIT");
  }

  rollbackRebuild(): void {
    try {
      this.db.exec("ROLLBACK");
    } catch {
      // No active transaction after an earlier SQLite failure.
    }
  }

  deleteForConversations(conversationIds: readonly string[]): void {
    if (conversationIds.length === 0) return;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const removeHydration = this.db.prepare(
        `DELETE FROM tool_call_hydration
         WHERE id IN (SELECT id FROM tool_calls WHERE conversation_id = ?)`,
      );
      const removePreview = this.db.prepare(
        "DELETE FROM tool_calls WHERE conversation_id = ?",
      );
      for (const conversationId of conversationIds) {
        removeHydration.run(conversationId);
        removePreview.run(conversationId);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  delete(id: string): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM tool_calls WHERE id = ?").run(id);
      this.db.prepare("DELETE FROM tool_call_hydration WHERE id = ?").run(id);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private readySnapshot(
    migrationFingerprint: string,
  ): ToolCallHydrationSnapshot {
    return {
      state: "ready",
      schemaVersion: TOOL_CALL_HYDRATION_SCHEMA_VERSION,
      migrationFingerprint,
      generation: (this.readSnapshot()?.generation ?? 0) + 1,
      canonicalCount: this.count("tool_calls"),
      hydrationCount: this.count("tool_call_hydration"),
    };
  }

  private writeHydration(toolCall: ToolCallRecord): void {
    const shouldHydrate =
      !["completed", "denied", "failed", "cancelled"].includes(
        toolCall.status,
      ) ||
      toolCall.toolName === "todos_set" ||
      toolCall.interactions.some(
        (interaction) => interaction.kind === "plan_review",
      );
    if (!shouldHydrate) {
      this.db
        .prepare("DELETE FROM tool_call_hydration WHERE id = ?")
        .run(toolCall.id);
      return;
    }
    this.db
      .prepare(
        `INSERT INTO tool_call_hydration (id, record_json) VALUES (?, ?)
         ON CONFLICT(id) DO UPDATE SET record_json = excluded.record_json`,
      )
      .run(toolCall.id, JSON.stringify(toolCall));
  }

  private writePreview(
    toolCall: ToolCallRecord,
    preview: ToolCallTranscriptRecord,
  ): void {
    this.db
      .prepare(
        `INSERT INTO tool_calls (
           id, conversation_id, project_id, agent_id, run_id, status,
           pending_interaction_kind, revision, updated_at, preview_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           conversation_id = excluded.conversation_id,
           project_id = excluded.project_id,
           agent_id = excluded.agent_id,
           run_id = excluded.run_id,
           status = excluded.status,
           pending_interaction_kind = excluded.pending_interaction_kind,
           revision = excluded.revision,
           updated_at = excluded.updated_at,
           preview_json = excluded.preview_json`,
      )
      .run(
        toolCall.id,
        toolCall.conversationId,
        toolCall.projectId,
        toolCall.agentId,
        toolCall.runId ?? null,
        toolCall.status,
        toolCall.interactions.find(
          (interaction) => interaction.status === "pending",
        )?.kind ?? null,
        toolCall.revision,
        toolCall.updatedAt,
        JSON.stringify(preview),
      );
  }

  private writeSnapshot(snapshot: ToolCallHydrationSnapshot): void {
    this.db
      .prepare(
        `INSERT INTO index_meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(META_KEY, JSON.stringify(snapshot));
  }

  private count(table: string): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
      .get() as { count: number } | undefined;
    return row?.count ?? 0;
  }
}
