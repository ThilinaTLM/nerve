import type { SQLOutputValue } from "node:sqlite";
import {
  type TrustedResource,
  trustedResourceSchema,
  type TrustedResourceKind,
} from "@nervekit/contracts/core";
import type { CoreDatabase } from "./database.js";

export class TrustedResourceRepository {
  constructor(private readonly db: CoreDatabase) {}

  get(id: string): TrustedResource | null {
    const row = this.db.sqlite
      .prepare("SELECT * FROM trusted_resource WHERE id = ?")
      .get(id);
    return row ? mapTrustedResource(row) : null;
  }

  insert(input: TrustedResource): TrustedResource {
    const row = trustedResourceSchema.parse(input);
    this.db.sqlite
      .prepare(
        "INSERT INTO trusted_resource (id, kind, project_id, path, name, content_digest, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        row.id,
        row.kind,
        row.projectId,
        row.path,
        row.name,
        row.contentDigest,
        row.status,
        row.createdAt,
        row.updatedAt,
      );
    return row;
  }

  update(
    id: string,
    patch: Partial<Omit<TrustedResource, "id" | "projectId" | "createdAt">>,
  ): TrustedResource {
    const existing = this.get(id);
    if (!existing) throw new Error(`TrustedResource not found: ${id}`);
    const row = trustedResourceSchema.parse({ ...existing, ...patch });
    this.db.sqlite
      .prepare(
        "UPDATE trusted_resource SET kind = ?, path = ?, name = ?, content_digest = ?, status = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        row.kind,
        row.path,
        row.name,
        row.contentDigest,
        row.status,
        row.updatedAt,
        id,
      );
    return row;
  }

  list(
    projectId: string | null,
    kind?: TrustedResourceKind,
  ): TrustedResource[] {
    return this.db.sqlite
      .prepare(
        "SELECT * FROM trusted_resource WHERE project_id IS ? AND (? IS NULL OR kind = ?) ORDER BY path, id",
      )
      .all(projectId, kind ?? null, kind ?? null)
      .map(mapTrustedResource);
  }

  find(
    kind: TrustedResourceKind,
    projectId: string | null,
    path: string,
  ): TrustedResource | null {
    const row = this.db.sqlite
      .prepare(
        "SELECT * FROM trusted_resource WHERE kind = ? AND project_id IS ? AND path = ?",
      )
      .get(kind, projectId, path);
    return row ? mapTrustedResource(row) : null;
  }

  delete(id: string): void {
    this.db.sqlite.prepare("DELETE FROM trusted_resource WHERE id = ?").run(id);
  }
}

function mapTrustedResource(
  row: Record<string, SQLOutputValue>,
): TrustedResource {
  return trustedResourceSchema.parse({
    id: row.id,
    kind: row.kind,
    projectId: row.project_id,
    path: row.path,
    name: row.name,
    contentDigest: row.content_digest,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}
