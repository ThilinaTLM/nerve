import type { SQLOutputValue } from "node:sqlite";
import { type ScratchNote, scratchNoteSchema } from "@nervekit/contracts/core";
import type { CoreDatabase } from "./database.js";

export class ScratchNoteRepository {
  constructor(private readonly db: CoreDatabase) {}

  get(id: string): ScratchNote | null {
    const row = this.db.sqlite
      .prepare("SELECT * FROM scratch_note WHERE id = ?")
      .get(id);
    return row ? mapScratchNote(row) : null;
  }

  insert(input: ScratchNote): ScratchNote {
    const row = scratchNoteSchema.parse(input);
    this.db.sqlite
      .prepare(
        "INSERT INTO scratch_note (id, project_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        row.id,
        row.projectId,
        row.title,
        row.content,
        row.createdAt,
        row.updatedAt,
      );
    return row;
  }

  update(
    id: string,
    patch: Partial<Omit<ScratchNote, "id" | "projectId" | "createdAt">>,
  ): ScratchNote {
    const existing = this.get(id);
    if (!existing) throw new Error(`ScratchNote not found: ${id}`);
    const row = scratchNoteSchema.parse({ ...existing, ...patch });
    this.db.sqlite
      .prepare(
        "UPDATE scratch_note SET title = ?, content = ?, updated_at = ? WHERE id = ?",
      )
      .run(row.title, row.content, row.updatedAt, id);
    return row;
  }

  list(projectId: string): ScratchNote[] {
    return this.db.sqlite
      .prepare(
        "SELECT * FROM scratch_note WHERE project_id = ? ORDER BY updated_at DESC, id",
      )
      .all(projectId)
      .map(mapScratchNote);
  }

  delete(id: string): void {
    this.db.sqlite.prepare("DELETE FROM scratch_note WHERE id = ?").run(id);
  }
}

function mapScratchNote(row: Record<string, SQLOutputValue>): ScratchNote {
  return scratchNoteSchema.parse({
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}
