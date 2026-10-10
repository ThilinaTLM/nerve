import type { SQLOutputValue } from "node:sqlite";
import {
  type AsyncBash,
  asyncBashSchema,
  type AsyncBashStatus,
} from "@nervekit/contracts/core";
import type { CoreDatabase } from "./database.js";

export class AsyncBashRepository {
  constructor(private readonly db: CoreDatabase) {}

  get(id: string): AsyncBash | null {
    const row = this.db.sqlite
      .prepare("SELECT * FROM async_bash WHERE id = ?")
      .get(id);
    return row ? mapAsyncBash(row) : null;
  }

  insert(input: AsyncBash): AsyncBash {
    const row = asyncBashSchema.parse(input);
    this.db.sqlite
      .prepare(
        "INSERT INTO async_bash (id, conversation_id, tool_call_id, command, working_directory, status, process_ref, exit_code, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        row.id,
        row.conversationId,
        row.toolCallId,
        row.command,
        row.workingDirectory,
        row.status,
        row.processRef,
        row.exitCode,
        row.startedAt,
        row.finishedAt,
      );
    return row;
  }

  update(
    id: string,
    patch: Partial<Omit<AsyncBash, "id" | "conversationId">>,
  ): AsyncBash {
    const existing = this.get(id);
    if (!existing) throw new Error(`AsyncBash not found: ${id}`);
    const row = asyncBashSchema.parse({ ...existing, ...patch });
    this.db.sqlite
      .prepare(
        "UPDATE async_bash SET tool_call_id = ?, command = ?, working_directory = ?, status = ?, process_ref = ?, exit_code = ?, started_at = ?, finished_at = ? WHERE id = ?",
      )
      .run(
        row.toolCallId,
        row.command,
        row.workingDirectory,
        row.status,
        row.processRef,
        row.exitCode,
        row.startedAt,
        row.finishedAt,
        id,
      );
    return row;
  }

  list(conversationId: string): AsyncBash[] {
    return this.db.sqlite
      .prepare(
        "SELECT * FROM async_bash WHERE conversation_id = ? ORDER BY started_at, id",
      )
      .all(conversationId)
      .map(mapAsyncBash);
  }

  listAll(): AsyncBash[] {
    return this.db.sqlite
      .prepare("SELECT * FROM async_bash ORDER BY started_at, id")
      .all()
      .map(mapAsyncBash);
  }

  listByStatus(status: AsyncBashStatus): AsyncBash[] {
    return this.db.sqlite
      .prepare(
        "SELECT * FROM async_bash WHERE status = ? ORDER BY started_at, id",
      )
      .all(status)
      .map(mapAsyncBash);
  }

  delete(id: string): void {
    this.db.sqlite.prepare("DELETE FROM async_bash WHERE id = ?").run(id);
  }
}

function mapAsyncBash(row: Record<string, SQLOutputValue>): AsyncBash {
  return asyncBashSchema.parse({
    id: row.id,
    conversationId: row.conversation_id,
    toolCallId: row.tool_call_id,
    command: row.command,
    workingDirectory: row.working_directory,
    status: row.status,
    processRef: row.process_ref,
    exitCode: row.exit_code,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  });
}
