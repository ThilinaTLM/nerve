import type { SQLOutputValue } from "node:sqlite";
import { type Project, projectSchema } from "@nervekit/contracts/core";
import type { CoreDatabase } from "./database.js";

export class ProjectRepository {
  constructor(private readonly db: CoreDatabase) {}

  get(id: string): Project | null {
    const row = this.db.sqlite
      .prepare("SELECT * FROM project WHERE id = ?")
      .get(id);
    return row ? mapProject(row) : null;
  }

  insert(input: Project): Project {
    const row = projectSchema.parse(input);
    this.db.sqlite
      .prepare(
        "INSERT INTO project (id, name, directory, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(row.id, row.name, row.directory, row.createdAt, row.updatedAt);
    return row;
  }

  update(
    id: string,
    patch: Partial<Omit<Project, "id" | "createdAt">>,
  ): Project {
    const existing = this.get(id);
    if (!existing) throw new Error(`Project not found: ${id}`);
    const row = projectSchema.parse({ ...existing, ...patch });
    this.db.sqlite
      .prepare(
        "UPDATE project SET name = ?, directory = ?, updated_at = ? WHERE id = ?",
      )
      .run(row.name, row.directory, row.updatedAt, id);
    return row;
  }

  list(): Project[] {
    return this.db.sqlite
      .prepare("SELECT * FROM project ORDER BY name, id")
      .all()
      .map(mapProject);
  }

  delete(id: string): void {
    this.db.sqlite.prepare("DELETE FROM project WHERE id = ?").run(id);
  }
}

function mapProject(row: Record<string, SQLOutputValue>): Project {
  return projectSchema.parse({
    id: row.id,
    name: row.name,
    directory: row.directory,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}
