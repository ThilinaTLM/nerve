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
        "INSERT INTO trusted_resource (id, kind, project_id, resource_key, name, content_digest, status, grants, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        row.id,
        row.kind,
        row.projectId,
        row.resourceKey,
        row.name,
        row.contentDigest,
        row.status,
        row.grants ? JSON.stringify(row.grants) : null,
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
        "UPDATE trusted_resource SET kind = ?, resource_key = ?, name = ?, content_digest = ?, status = ?, grants = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        row.kind,
        row.resourceKey,
        row.name,
        row.contentDigest,
        row.status,
        row.grants ? JSON.stringify(row.grants) : null,
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
        "SELECT * FROM trusted_resource WHERE project_id IS ? AND (? IS NULL OR kind = ?) ORDER BY resource_key, id",
      )
      .all(projectId, kind ?? null, kind ?? null)
      .map(mapTrustedResource);
  }

  find(
    kind: TrustedResourceKind,
    projectId: string | null,
    resourceKey: string,
  ): TrustedResource | null {
    const row = this.db.sqlite
      .prepare(
        "SELECT * FROM trusted_resource WHERE kind = ? AND project_id IS ? AND resource_key = ?",
      )
      .get(kind, projectId, resourceKey);
    return row ? mapTrustedResource(row) : null;
  }

  delete(id: string): void {
    this.db.sqlite.prepare("DELETE FROM trusted_resource WHERE id = ?").run(id);
  }
}

function mapTrustedResource(
  row: Record<string, SQLOutputValue>,
): TrustedResource {
  const raw = {
    id: row.id,
    kind: row.kind,
    projectId: row.project_id,
    resourceKey: row.resource_key,
    name: row.name,
    contentDigest: row.content_digest,
    status: row.status,
    grants: typeof row.grants === "string" ? JSON.parse(row.grants) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  const parsed = trustedResourceSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  // A grant snapshot of an older shape (the release before `capabilities` became `models` and
  // `frame`) cannot be read. The decision does not count: it reads as rejected without grants, and
  // the user's next decision replaces it.
  const unreadable = trustedResourceSchema.safeParse({
    ...raw,
    status: "rejected",
    grants: null,
  });
  if (unreadable.success && raw.kind === "extension") return unreadable.data;
  throw parsed.error;
}
